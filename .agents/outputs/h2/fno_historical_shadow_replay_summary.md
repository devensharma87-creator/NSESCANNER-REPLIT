# H2 — F&O Historical Shadow Replay Summary

  > **historically replayed / offline shadow evidence / approximate / not live-verified / not decision-grade alone**
  > BE-trail results are approximate / upper-bound only because snapshot cadence is ~5 minutes and intra-window tick ordering is unknown.
  > Long-premium-only model (the paper trader always buys options). No production logic, DB rows, schema, or MFE/MAE backfills were touched by this script.

  ## A. Trades checked
  14

  ## B. Trades reconstructable
  7  (good_5min: 4, approximate_expiry_ambiguous: 3)

  ## C. Trades not reconstructable
  7  (insufficient_no_snapshots: 6, insufficient_midcpnifty_not_snapshotted: 1)

  ## D. Coverage percentage
  50.0 %

  ## E. Data-quality breakdown

  | Grade | Trades |
  |---|---|
  | good_5min | 4 |
  | approximate_expiry_ambiguous | 3 |
  | insufficient_no_snapshots | 6 |
  | insufficient_midcpnifty_not_snapshotted | 1 |

  ## F. Aggregate ACTUAL realized P&L (reconstructable subset only)
  +₹10789.70

  ## G. Aggregate SHADOW P&L for R1–R5 (reconstructable subset only)

  | Rule | Aggregate shadow P&L | Δ vs actual |
  |---|---|---|
  | R1 (full exit @ +30 %) | +₹16215.87 | +₹5426.17 |
  | R2 (full exit @ +60 %) | +₹9549.30 | −₹1240.40 |
  | R3 (50 % @ +30 % + BE trail) | +₹16812.99 | +₹6023.29 |
  | R4 (50 % @ +50 % + BE trail) | +₹20056.18 | +₹9266.48 |
  | R5 (full BE after +50 % MFE) | +₹17410.10 | +₹6620.40 |

  If a rule never triggers for a given trade, the position is held to its actual exit (so deltas are conservative, not optimistic).

  ## H. Hit-rate for +30 / +50 / +60 % MFE (reconstructable subset)

  | Threshold | Trades hitting | Hit-rate |
  |---|---|---|
  | +30 % | 6 / 7 | 85.7 % |
  | +50 % | 5 / 7 | 71.4 % |
  | +60 % | 3 / 7 | 42.9 % |

  ## I. Which rule looks directionally interesting

  Best aggregate shadow P&L: **R4 = +₹20056.18** (Δ vs actual +₹9266.48).
  **Label: directionally interesting, not live-approved.** Sample size = 7, far below the P25 20-live-trade bar.

  ## J. Which results are outlier-dependent

  | Rule | Single-trade share of total |abs| contribution | Dominant trade |
  |---|---|---|
  | R1 | 28.1 % | ea78ae5b-cfda-419e-90a1-8a47fe5b034e |
  | R2 | 26.2 % | f972d815-5be9-43ee-8fb5-9d0587e74a6d |
  | R3 | 31.2 % | e927944b-3349-4651-aaa3-4b32f2de0b8b |
  | R4 | 30.3 % | e927944b-3349-4651-aaa3-4b32f2de0b8b |
  | R5 | 43.1 % | e927944b-3349-4651-aaa3-4b32f2de0b8b |

  Any rule whose top-trade |abs| share > 50 % is **outlier-dependent** and must not be promoted on this evidence.

  ## K. Does this change P25 gate status?
  **NO.** H2 is offline shadow evidence on 7 trades with 5-min cadence approximation and expiry-inference uncertainty. **It does not reduce the P25 20-live-trade requirement.**

  ## L. What still requires live evidence
  - Real paper-trader exit-code execution path
  - Real Kite LTP tick path between snapshot bars
  - Real bid/ask/spread at decision time
  - Real force-exit-vs-stop race ordering
  - Real circuit-breaker behaviour
  - Real `lastPremium` refresh cadence under load
  - **F&O P25 20-live-trade acceptance gate (unchanged).**
  - **S2b** intraday refresh live verification (unchanged)
  - **S3b** post-deep-scan RS benchmark verification (unchanged)

  ## M. Confirmation that no code/schema/trading behaviour changed
  - No DB writes performed (only `SELECT` via the read-only sandbox).
  - No schema, scheduler, workflow, app code, route auth, `replit.md`, or memory/docs were modified.
  - Outputs are **scratch-only** under `.agents/outputs/h2/` (CSV + this summary).
  - No changes to: F&O signal generation / entry / exit / stop / target / partial / trail / sizing / gates / confluence / realised P&L / DD / circuit breakers; swing scoring / action / entry / stop / target / RR; intraday refresh; trigger latch; paper-equity execution; option-snapshot ingestion; candle warehouse.
  - 571/571 api-server tests + workspace typecheck remain as last green checkpoint.

  ## Standing labels applied to this artefact
  - `historically replayed`
  - `offline shadow evidence`
  - `approximate`
  - `not live-verified`
  - `not decision-grade alone`
  - `not decision-grade` applies to 3 trade(s) flagged `approximate_expiry_ambiguous`

  After H2: **STOPPING. Awaiting next instruction. No H3 or implementation work initiated.**
  