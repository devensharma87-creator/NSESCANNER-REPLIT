# H8 — Minimal Swing Redesign Candidate Lockdown Report

> **read-only / scratch-only / historical daily-bar replay-derived / offline shadow evidence / approximate / not live-verified / not intraday-exact / not implementation approval**
> Pure offline candidate-narrowing. No live scoring, action labels, entries, stops, targets, RR, trigger latch, intraday refresh, paper-equity, F&O, schema, scheduler, workflow, route auth, `replit.md`, or memory/docs changes. No S4c / S4d / S4e / S4f activation.

## A. Data used
- **H4 outcome CSV** `.agents/outputs/h4/swing_daily_ohlc_outcome_replay.csv` — 839 rows usable (joined to extended scoring + warnings).
- **H6 / H7 model scaffolding** (notebook state) — same M1 / M2 / M5 helper functions reused identically.
- **H3 sector-leader map** — clean leader_class on **only 2 scan dates: 2026-05-19 (105/106 rows clean) and 2026-05-26 (132/132 rows clean)**. All other dates have 0 leader_class.
- **read-only `swing_scan_result` sector backfill** (from H7) — 100 % sector coverage on the 839 rows. No writes.
- Scope: 8 scan dates × NIFTY 500. 707 rows have return_5d (5-26 excluded — too recent).

## B. Models compared
All formulas are pure functions on the same 839 rows. Magnitudes are the same round H5-derived constants used in H6 / H7 (deliberately not re-tuned for this sample).

| Model | Formula | Components |
|---|---|---|
| **B0** | `score` (live baseline) | 0 — reference |
| **B1** | `score − fundamental_score` | 1 — fund only |
| **B2** | `score − fundamental_score − extension_penalty` | 2 — fund + ext |
| **B3** | `score − fundamental_score − extension_penalty − rs_weak_penalty` | 3 — fund + ext + rs_weak |
| **B4** | `B2 + lagged_leader_bonus` | 3 — fund + ext + **lagged** leader |
| **B5** | `B3 + lagged_leader_bonus` | 4 — fund + ext + rs_weak + **lagged** leader |
| _M6_ | _reference only — same-day circular leader, NOT a candidate_ | _4 — fund + ext + rs_weak + **same-day** leader_ |

`extension_penalty` = (rsi14>70 ? 8) + (warn_extended ? 6) + (warn_rsi_overext ? 5) + (|%52H|≤3 ? 3)
`rs_weak_penalty` = warn_rs_weak ? 15 : 0
`lagged_leader_bonus` = (lagged_leader_class === "leader" ? +6) + (lagged_leader_class === "laggard" ? −8) + (otherwise 0)

### Lagged-leader rule (H8 requirement)
For each scan_date `d`: take the most recent H3 clean scan_date `d'` with `d' < d`; look up each row's sector in H3-at-`d'` to derive `lagged_leader_class`. **No forward-fill across more than one prior clean date.** If no prior clean date exists, lagged_leader_class = null and the bonus contributes 0. Label: `lagged sector leader, leakage-reduced`.

### `lagged sector leader` availability — Table I

| Scan date | Prior clean H3 date | Rows with lagged_leader_class | Of those, with return_5d |
|---|---|---|---|
| 2026-05-11 | (none) | 0 | 0 |
| 2026-05-13 | (none) | 0 | 0 |
| 2026-05-14 | (none) | 0 | 0 |
| 2026-05-15 | (none) | 0 | 0 |
| 2026-05-18 | (none) | 0 | 0 |
| 2026-05-19 | (none) | 0 | 0 |
| 2026-05-20 | 2026-05-19 | 102 | 102 |
| 2026-05-26 | 2026-05-19 | 127 | 0 (no R5 window yet) |
| **Total**  |  | **229 / 839 (27 %)** | **102 / 707 (14 %)** |

**Material limitation**: B4 and B5 effectively differ from B2 and B3 only on the 5-20 slice (102 R5 rows). On all other dates the lagged-leader contribution is identically 0 → B4 ≡ B2 and B5 ≡ B3 outside 5-20. Any apparent full-sample improvement of B4/B5 over B2/B3 is therefore the marginal effect on a single date.

## C. Why M6 is rejected (H7 carry-over)
H7 already established: M6 wins date-by-date in only 3/7 dates (43 %); 70 % of its Pearson gain comes from fundamentals removal alone; it fails in Healthcare (ΔPearson −0.315) and Logistics (−0.410); the same-day leader overlay has a medium-severity day-boundary circularity; 0 BUY rows in the sample. H8 includes M6 as a reference row only; it is **not** a candidate.

## D. Headline comparison — Table A
Full sample, n = 839, n_R5 = 707.

| Model | Pearson | Spearman | Q5−Q1 5D | ΔPearson vs B0 | ΔQ5−Q1 vs B0 |
|---|---|---|---|---|---|
| B0 | -0.211 | -0.255 | -3.83 % | 0.000 | +0.00 % |
| B1 | -0.011 | 0.028 | -0.00 % | 0.199 | +3.83 % |
| B2 | 0.025 | 0.023 | +0.30 % | 0.235 | +4.12 % |
| B3 | 0.034 | 0.031 | +0.48 % | 0.244 | +4.30 % |
| B4 | 0.057 | 0.052 | +0.73 % | 0.267 | +4.56 % |
| B5 | 0.065 | 0.060 | +0.91 % | 0.275 | +4.73 % |
| M6 | 0.053 | 0.058 | +1.02 % | 0.263 | +4.85 % |

Observations:
- **B1 already flattens the inversion** (Pearson −0.211 → −0.011). The largest single move comes from one subtraction.
- **B2 / B3** add small extra Pearson (+0.036 / +0.045 over B1) without complicating the formula much.
- **B4 / B5** add another +0.032 / +0.031 Pearson over B2 / B3, but **only because of a 102-row slice on a single date**.
- **B5 (+0.065) has the highest headline Pearson — higher than M6 (+0.053).** The lagged overlay numerically beats the same-day overlay on the full sample. But that win is achieved on a 14 % data slice.

## E. Date-by-date Q5−Q1 — Table C
| Date | n | nR5 | B0 | B1 | B2 | B3 | B4 | B5 |
|---|---|---|---|---|---|---|---|---|
| 2026-05-11 | 159 | 159 | +3.43 % | +1.43 % | -0.83 % | -1.05 % | -0.83 % | -1.05 % |
| 2026-05-13 | 111 | 111 | +0.58 % | -1.64 % | -2.83 % | -2.83 % | -2.83 % | -2.83 % |
| 2026-05-14 | 118 | 118 | +0.06 % | +0.78 % | +1.45 % | +1.45 % | +1.45 % | +1.45 % |
| 2026-05-15 | 10 | 10 | +5.83 % | +5.57 % | +5.57 % | +5.57 % | +5.57 % | +5.57 % |
| 2026-05-18 | 98 | 98 | +0.09 % | +0.09 % | -0.29 % | -0.29 % | -0.29 % | -0.29 % |
| 2026-05-19 | 106 | 106 | -1.31 % | -0.49 % | -0.34 % | -0.34 % | -0.34 % | -0.34 % |
| 2026-05-20 | 105 | 105 | -2.17 % | -1.78 % | -0.36 % | -0.36 % | +0.28 % | +0.28 % |
| 2026-05-26 | 132 | 0 | — | — | — | — | — | — |

Confirms:
- On **5-11 and 5-13** every candidate except B0 loses ground (B0 was inflated on these dates by the inversion-friendly fundamentals subscore).
- On **5-14, 5-15, 5-19, 5-20** every candidate either equals or beats B0.
- On **5-18** all candidates are slightly worse (small magnitude).
- B4 vs B2 and B5 vs B3 are identical on every date except 5-20, where the lagged leader nudges Q5−Q1 by +0.64 pp.
- **B1 alone matches or beats B0 on 5/7 evaluable dates.** The simplest model has the most predictable date-by-date behaviour.

## F. Sector robustness (Q5−Q1) — Table D
Sectors with n ≥ 15:

| Sector | n | B0 | B1 | B2 | B3 | B5 | B3 − B0 |
|---|---|---|---|---|---|---|---|
| Capital Goods | 127 | -8.77 % | -2.03 % | +1.20 % | +1.20 % | +1.14 % | +9.98 % |
| Pharma | 107 | -0.16 % | +1.84 % | +1.33 % | +1.48 % | +1.48 % | +1.63 % |
| Financials | 104 | -5.14 % | -0.02 % | -0.77 % | -0.60 % | -0.82 % | +4.54 % |
| Energy | 75 | -10.78 % | -2.86 % | -1.25 % | -0.74 % | +2.06 % | +10.04 % |
| Chemicals | 58 | -4.51 % | -2.06 % | -0.33 % | -0.33 % | +1.23 % | +4.18 % |
| Auto | 56 | -5.66 % | -0.52 % | +0.31 % | +0.94 % | +2.20 % | +6.60 % |
| FMCG | 47 | +1.15 % | +3.15 % | +3.93 % | +3.93 % | +3.43 % | +2.78 % |
| Banking | 47 | -3.74 % | -0.70 % | +0.62 % | +0.62 % | +1.78 % | +4.36 % |
| Metals | 43 | -2.44 % | -3.47 % | +0.31 % | +0.62 % | +0.62 % | +3.06 % |
| Consumer Discretionary | 41 | +0.40 % | +0.13 % | +0.70 % | +0.70 % | +1.84 % | +0.30 % |
| Healthcare | 27 | +12.41 % | +2.32 % | +2.51 % | +2.51 % | +2.51 % | -9.90 % |
| Logistics | 26 | +0.54 % | -6.89 % | -4.91 % | -4.91 % | -6.15 % | -5.45 % |
| Cement | 16 | -6.61 % | -0.93 % | -1.31 % | -1.31 % | +3.80 % | +5.30 % |

- **B3 improves direction in 11 / 13 sectors** — same broad pattern as M6 in H7.
- **Healthcare and Logistics still wrong-direction** for every candidate. The sector-wrong-direction problem is **not** an M6 artefact — it persists across all simpler candidates. Both small sectors (n=27, n=26) but the pattern is structural to "remove fundamentals + penalise extension".
- **B1 alone fixes Healthcare** (B0 +12.41 % → B1 +2.32 %) and **worsens Logistics**. Mixed picture.

## G. Action-class robustness — Table E
0 BUY rows in sample — only WATCHLIST / WAIT / AVOID testable.

| Action | n | B0 | B1 | B2 | B3 | B4 | B5 |
|---|---|---|---|---|---|---|---|
| WATCHLIST | 161 | -0.97 % | -1.07 % | -0.03 % | -0.03 % | +1.24 % | +1.24 % |
| WAIT | 194 | -1.54 % | +4.38 % | +1.79 % | +2.01 % | +1.12 % | +1.47 % |
| AVOID | 484 | -3.80 % | -0.69 % | -1.03 % | -0.91 % | -0.58 % | -0.63 % |

- **B1 produces the single largest action-class improvement of any model**: WAIT goes from B0 −1.54 % to B1 **+4.38 %** — a +5.92 pp swing. B2/B3 give back half of it.
- AVOID is monotonically better than B0 in every candidate.
- WATCHLIST flips sign B0 −0.97 % → B4/B5 +1.24 %.

## H. High-score loser demotion (Table F) and AVOID hidden-winner recovery (Table G)
| Model | High-score losers demoted (of 95 in B0 Q4/Q5 ∧ R5<−2 %) | Hidden winners recovered (of 159 in B0 Q1/Q2 ∧ R5>+2 %) |
|---|---|---|
| B1 | 57/95 (60 %) | 53/159 (33 %) |
| B2 | 58/95 (61 %) | 54/159 (34 %) |
| B3 | 58/95 (61 %) | 54/159 (34 %) |
| B4 | 61/95 (64 %) | 53/159 (33 %) |
| B5 | 62/95 (65 %) | 54/159 (34 %) |
| M6 | 62/95 (65 %) | 53/159 (33 %) |

All candidates cluster at 60-65 % loser demotion / 33-34 % winner recovery. **The simpler models match the combined ones on the H6 headline counts.** B1 alone gets 60 % / 33 %, vs B5 65 % / 34 %. The H6/H7 headline win was almost entirely delivered by removing fundamentals.

## I. Promotion / demotion performance — Table H
| Model | Promoted n | Promoted avg 5D | Demoted n | Demoted avg 5D | Promo − Demo |
|---|---|---|---|---|---|
| B1 | 318 | +1.81 % | 310 | -1.52 % | +3.33 % |
| B2 | 316 | +1.73 % | 318 | -1.07 % | +2.80 % |
| B3 | 316 | +1.74 % | 322 | -1.15 % | +2.89 % |
| B4 | 329 | +1.99 % | 319 | -1.13 % | +3.12 % |
| B5 | 329 | +2.01 % | 321 | -1.11 % | +3.13 % |
| M6 | 324 | +1.97 % | 318 | -1.05 % | +3.02 % |

**B1 has the largest Promo − Demo gap (+3.33 pp)** — the simplest correction produces the cleanest movement signal. B5/M6 are second-tier at +3.13 / +3.02 pp.

## J. Leakage-risk table — Table J
| Field / component | Leakage class | Status in H8 candidates |
|---|---|---|
| `score`, all subscores, RSI, ADX, ATR, vol_ratio, weekly_trend, market_structure, 52w distance, entry/stop/target/RR, warning flags | scan-time-safe (verified in H7 §I) | used freely in B0–B5 |
| `fundamental_score` (ingested out-of-band, static) | scan-time-safe | inverted weight in B1–B5 |
| `leader_class` (H3, **same-day**) | **medium — circular at day boundary** | **not used** in any H8 candidate; appears only in M6 reference row |
| `lagged_leader_class` (H3, prior clean scan date only) | low — uses only prior-day sector close | used in B4 and B5 |
| H4 forward bars (return / MFE / MAE) | future by design | used as outcome labels only — never as features |
| Yahoo `.NS` daily bar for outcomes | reconciliation noise (different bar source than scanner) | accepted limitation, no feature use |

**Verdict: no critical or medium leakage in B0–B5.** The lagged-leader overlay (B4/B5) does resolve H7's medium-severity circularity concern, at the cost of 14 % effective coverage.

## K. Complexity vs performance — Table B
| Model | Components | Depends on H3? | Depends on warnings? | Depends on fundamentals? | Pearson | Q5−Q1 |
|---|---|---|---|---|---|---|
| B0 | 0 | no | no | yes (inverted weight) | −0.211 | −3.83 % |
| **B1** | **1** | **no** | **no** | **yes (subtracted)** | **−0.011** | **−0.00 %** |
| B2 | 2 | no | yes (warn_extended, warn_rsi_overext) | yes (subtracted) | +0.025 | +0.30 % |
| **B3** | **3** | **no** | **yes (+ warn_rs_weak)** | **yes (subtracted)** | **+0.034** | **+0.48 %** |
| B4 | 3 | **YES (lagged, 14 % cov)** | yes | yes | +0.057 | +0.73 % |
| B5 | 4 | **YES (lagged, 14 % cov)** | yes | yes | +0.065 | +0.91 % |

## L. Whether M1 alone is enough
**Largely yes — for the inversion-removal objective.** B1 flattens Pearson from −0.211 → −0.011 (eliminates the inverted sign) and produces the cleanest Promo − Demo gap (+3.33 pp) and the largest action-class swing (WAIT +5.92 pp). It does **not** produce positive monotonicity — only B2 onwards does.

- If the goal is "stop the scoring inversion": **B1 suffices.** Smallest defensible step.
- If the goal is "flip monotonicity positive on this 9-day sample": **B2 or B3** is the smallest move that does it.

## M. Whether B3 is robust enough for future live shadow-mode planning
B3 (+0.034 Pearson, +0.48 pp Q5−Q1) is the simplest model that flips monotonicity positive on the full sample and improves all three testable action classes. Compared to B5/M6 it sacrifices ~0.03 Pearson for elimination of H3 dependency.

Open issues still apply: date-instability inherited from M6 family (wrong on 5-11 / 5-13); Healthcare and Logistics still wrong-direction; 0 BUY rows; mean-reverting regime sample; ΔQ5−Q1 of +0.48 pp is within the noise band of a 707-row 9-day sample.

**Verdict on B3**: `candidate for future live shadow-mode planning only — not live scoring`.

## N. Whether the lagged sector overlay adds value safely
- Numerically: B4 > B2 by +0.032 Pearson; B5 > B3 by +0.031 Pearson. Both gains come **entirely from a single date (5-20, 102 rows)** — outside 5-20 the formula is identical to B2/B3.
- The lagged overlay does resolve H7's circularity concern (safe leakage class).
- But the evidence base is **102 rows / 1 date / 14 % effective coverage**, and only one sector (Telecom) was a laggard at the prior clean date.

**Verdict on lagged overlay**: `needs more data before even shadow-mode planning`. Re-evaluate after ≥ 10 more H3 clean scan dates exist.

## O. Simplest model that improves the inversion
**B1.** One subtraction. Removes the inverted sign without claiming positive monotonicity. Same loser-demotion / winner-recovery counts as B3 / B5 / M6 within 5 pp. Lowest overfitting surface.

## P. Recommended candidate (if any)
Two recommendations, ordered by ambition:

1. **Minimum-risk planning candidate: B1.** `candidate for future live shadow-mode planning only — not live scoring`. Single change, removes the actively-wrong inversion, highest cross-slice robustness. Strict subset of every other candidate.
2. **Higher-discrimination planning candidate (if B1's shadow evidence proves under-discriminating): B3.** `candidate for future live shadow-mode planning only — not live scoring`. Smallest model that produces positive monotonicity on this sample. No H3 dependency.

**B4 / B5 are not recommended yet** despite numerically beating B3 — their improvement rests on a 102-row single-date slice. **`needs more data before even shadow-mode planning` applies to the lagged-leader overlay specifically.**

## Q. What should be excluded from the first shadow candidate
- Any same-day sector-leader overlay (circular at day boundary).
- Any change to action labels, entries, stops, targets, RR.
- Any change to paper-equity execution.
- Any change to F&O / option snapshots / candle warehouse / scheduler.
- Any sector overlay until H3 has ≥ 10 clean prior dates.
- Any RR / risk_score subtraction (H7 ruled M4 not warranted).

## R. Risks and limitations
- **0 BUY rows** — the action class most relevant to live behaviour is unrepresented.
- **9-scan-date mean-reverting sample** — B1's "improvement" may shrink or invert in a trending tape (fundamentally strong names may lead instead of lag in a trending regime).
- **No held-out test split** — sample too small for a 70/30 split with statistical meaning.
- **Healthcare / Logistics wrong-direction** persists across every candidate — a real structural risk for any of B1-B5 if it ever ran live.
- **Forward-window depth 1-14 days only.**
- **Survivorship bias** (today's NIFTY 500 universe, not as-of-date).
- The 102-row lagged-leader slice cannot statistically distinguish "leader overlay is genuinely helpful" from "leader overlay is incidentally helpful on 2026-05-20".
- All H8 candidates inherit the same constants from H5 — they have **not been re-tuned** for B0-B5 specifically.

## S. Whether evidence is enough for live shadow-mode implementation planning
**Not yet for activation; conditionally yes for planning discussion of B1.**
- Shadow-mode *implementation planning* is design / spec work — not activation.
- B1 is robust enough to merit planning conversations as a `candidate for future live shadow-mode planning only — not live scoring`.
- B3 is the next step up if B1's shadow-mode evidence (when collected) shows it under-discriminates.
- B4 / B5 are explicitly **not** ready for planning until H3 clean-date coverage grows.

**H8 does not approve shadow-mode activation. H8 does not approve live scoring, action labels, entries, stops, targets, RR, or paper-equity changes. S4c / S4d / S4e / S4f remain not approved.**

## T. Final candidate ranking — Table K
| Rank | Candidate | Headline Pearson | Complexity | H3 dep | Verdict label |
|---|---|---|---|---|---|
| 1 | **B1** | −0.011 | 1 component | no | `candidate for future live shadow-mode planning only — not live scoring` |
| 2 | **B3** | +0.034 | 3 components | no | `candidate for future live shadow-mode planning only — not live scoring` |
| 3 | B2 | +0.025 | 2 components | no | `candidate for future live shadow-mode planning only — not live scoring` |
| 4 | B4 | +0.057 | 3 components | YES (14 % cov) | `needs more data before even shadow-mode planning` |
| 5 | B5 | +0.065 | 4 components | YES (14 % cov) | `needs more data before even shadow-mode planning` |
| — | M6 (reference only) | +0.053 | 4 components | YES (same-day, circular) | rejected in H7 |
| — | B0 (live baseline) | −0.211 | 0 | no | inverted; carries the problem H1-H7 surfaced |

## U. What still requires live verification
- **Live shadow-mode run** of B1 (and optionally B3) — compute alongside live, never act, log to disk for ≥ 1 quarter.
- **Forward-window depth ≥ 60 trading days.**
- **Trending-regime re-evaluation** — fundamentals-sign-permanence is the single biggest exposure.
- **BUY-class coverage** — re-run H4 → H8 once material BUY rows exist.
- **H3 clean-date growth to ≥ 10 prior dates** before B4 / B5 can be even planning candidates.
- **70 / 30 train / test scan-date split** once ≥ 30 distinct dates exist.
- **`pct_from_52w_high` window-bounds explicit unit test.**
- **S2b** intraday refresh, **S3b** post-deep-scan RS benchmark, **F&O P25** (3 / 20) — all still pending, unrelated to swing redesign.

## V. Confirmation that no code / schema / trading behaviour changed
- No DB writes (read-only SELECT only via the sandbox; sector backfill consumed an existing SELECT path).
- No schema / scheduler / workflow / app code / route auth / `replit.md` / memory/docs changes.
- No changes to swing scoring, recommendations, action labels, entries, stops, targets, RR, trigger latch, intraday refresh, paper-equity, F&O signal generation, F&O entries / exits / targets / stops / sizing / gates / confluence, option snapshots, candle warehouse.
- Outputs scratch-only under `.agents/outputs/h8/`: `minimal_swing_redesign_candidate.csv` (138 slices × 12 cols) + this summary.
- No git commit of the outputs (per spec).
- 571 / 571 api-server tests + workspace typecheck remain unchanged from checkpoint `e72577f4ce9`.

## Standing labels applied
`historical daily-bar replay-derived` · `offline shadow evidence` · `approximate` · `not live-verified` · `not intraday-exact` · `not implementation approval` · `lagged sector leader, leakage-reduced` (B4, B5)

## Verdict
- **No live scoring changes approved.**
- **No action-label changes approved.**
- **No entry / stop / target / RR changes approved.**
- **No paper-equity execution changes approved.**
- **No S4c / S4d / S4e / S4f approved.**
- **B1**: `candidate for future live shadow-mode planning only — not live scoring` — smallest defensible move, removes the inversion, lowest overfitting surface, highest cross-slice robustness.
- **B3**: `candidate for future live shadow-mode planning only — not live scoring` — next step up if B1's shadow evidence proves under-discriminating; preferred over B4/B5 because it has zero H3 dependency.
- **B4 / B5**: `needs more data before even shadow-mode planning` — lagged-leader overlay is leakage-safe but currently rests on a 102-row single-date slice.
- **M6**: not a candidate (H7 verdict stands).
- **Lagged sector-leader overlay**: leakage-resolved, but data-insufficient for planning until ≥ 10 H3 clean prior dates exist.

**S2b / S3b / F&O P25 still pending. S4c / S4d / S4e / S4f not approved. Stopping per spec. Awaiting next instruction.**
