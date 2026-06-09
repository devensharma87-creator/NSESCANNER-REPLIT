# Backtest Lab Rectification / Synthetic Premium Honesty — BACKLOG (audit-driven, NOT yet actioned)

> **Status:** Deferred standalone task. **Do NOT** execute inside Portfolio (T004, closed) or T003
> (Home / Market Pulse index analytics). **Do NOT** touch the live F&O engine unless explicitly
> required. Focus is strictly the Strategy Research / Backtest Lab output + labelling.
>
> **Lane discipline (owner-set):** Closed = T004 Portfolio · Next = T003 Home/Market-Pulse index
> analytics · Later = this Backtest Lab rectification.

## Audit finding (accepted as a completed audit slice)

The historical Strategy Research option backtest is **internally consistent mathematically**, but the
**option-premium layer is synthetic** and must not be presented as a real option-chain backtest.

What is real / correct:
- Spot/index data is authentic and internally consistent (cross-checked vs NSE/BSE/TradingView; sampled
  levels reconcile to real history; final point lines up with the live board).
- Trading calendar is correct — incl. the Saturday-dated rows on 01-Feb-2025 / 01-Feb-2026, which are
  genuine special Union Budget sessions, not bugs.
- Lot multipliers verified exactly: NIFTY = 75, BANKNIFTY = 35, SENSEX = 20 (match current SEBI lots).
- `gross = (exit_prem − entry_prem) × lot` holds for all rows (every trade modelled long-premium:
  LONG→buy Call, SHORT→buy Put). `net = gross − costs` holds to ±₹0.01.
- T1 target exit = exactly 2.25× entry premium (+125%) in 100% of T1 rows.

What is synthetic / wrong (the truth problem):
- **Entry premium = exactly 0.400% of spot for every row** (zero variance across all ~1,450 rows). Real
  ATM premiums swing with days-to-expiry and IV; a flat 0.40% is a placeholder.
- **Implied delta = exactly 0.500 for every row** (premium_move / signed_spot_move ≈ 0.491–0.502). A
  constant 0.5-delta linear proxy: **no gamma/convexity**.
- **No theta / time decay** — premium path is a pure linear function of spot; TIME_EXIT trades that go
  nowhere in spot show no decay (unrealistic into expiry).
- **No IV, no real strike/expiry/option-chain premium path.**
- **Stop-loss doc/data mismatch:** modal STOPPED exit ≈ **0.625× entry (−37.5%)**, not the **−30%** the
  codebase summary claims. ~30 rows/file stop deeper (down to 0.28×) → stop is gap-through, not capped.
- **Cost model** is a blended ~0.65% of round-trip turnover (band 0.61–0.68%), with a slight negative
  intercept (under-charges the smallest trades). Real STT on options is sell-side premium only, not
  symmetric turnover → current model is an approximation, not the real fee schedule.

**Conclusion:** Strategy Research P&L overstates real option-buying performance (no theta bleed, no IV
crush, no illiquid-strike slippage). Treat the published returns as an upper bound. (For reference, the
audited aggregates: NIFTY +₹1,09,218 / PF 1.18, SENSEX +₹65,897 / PF 1.12, BANKNIFTY −₹8,274 / PF 0.99;
with real theta+IV layered in, BANKNIFTY almost certainly goes net-negative.)

## Required fixes (the later task)

1. **Label existing results honestly** — "Synthetic premium Strategy Research — not real option-chain
   backtest." Old CSVs remain available but clearly labelled.
2. **UI warning wherever old backtest P&L appears** — "Premiums are modelled from spot movement using a
   synthetic delta proxy. Results are research-only and may overstate real option-buying performance."
3. **Resolve the stop-loss mismatch** — either make the model actually use a 30% premium stop, OR update
   docs/UI/export labels to the actual ~37.5% premium stop. Do not leave model/docs/UI inconsistent.
4. **Pricing modes** — tag every row/run:
   - `REAL_CHAIN` — real captured option-chain premium exists.
   - `BLACK_SCHOLES_MODELLED` — real chain unavailable; price via existing `blackScholes.ts` (spot + IV
     proxy + actual time-to-expiry → theta + convexity appear).
   - `SYNTHETIC_DELTA_PROXY` — legacy 0.40%-spot / 0.50-delta research rows.
5. **Missing export columns** — `trade_id, index, option_type (CE/PE), strike, expiry, days_to_expiry,
   IV, delta, theta, gamma (where avail), lot_size, lots, capital_deployed, slippage, brokerage, STT,
   exchange_charges, GST, stamp_duty, MFE, MAE, pricing_mode, data_source, model_warning`.
   - Itemise costs (STT sell-side, brokerage, exchange txn, GST, stamp) instead of one blended 0.65%.
   - MFE/MAE align the CSV with the fields the live P25 gate needs → makes Strategy Research directly
     comparable to Real Replay.

## Tests (the later task)

- Synthetic rows cannot be labelled real.
- Real option-chain rows must carry strike/expiry/CE-PE/source.
- Black-Scholes rows must expose IV/time-to-expiry/Greeks.
- Stop-loss calculation matches docs.
- Cost itemisation sums to total cost.
- UI warning appears for synthetic-premium research.

## Acceptance (the later task)

- No user can mistake synthetic-premium Strategy Research for a real tradable-options backtest.
- Old results remain available but clearly labelled.
- Future backtests distinguish real-chain / Black-Scholes-modelled / synthetic-proxy results.
- Documentation, UI, CSV exports, and code assumptions all match.

## Open verification carried over from the audit

- Confirm `EXPIRED_TRIGGERED` / `exit_at` semantics are sourced from the live captured-chain table, NOT
  this synthetic proxy (none of these rows carry that outcome).
