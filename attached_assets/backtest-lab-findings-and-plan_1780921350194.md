# Backtest Lab — Developer Checklist & F&O Accuracy Plan

**Platform:** Market Scanner by Dev — Backtest Lab
**Date:** 08 Jun 2026
**Source:** Real Replay run (n=18 decided) + Strategy Research run (n=5784 decided)
**Status:** Research / paper-only. Not for capital deployment.

---

## Part A — What the two runs are telling us (read this first)

The two screenshots are **not comparable**, and conflating them is the biggest risk on this page.

| Metric | Real Replay (Official Engine) | Strategy Research (delta proxy) |
|---|---|---|
| Decided trades | 18 | 5,784 |
| Win rate | 16.67% | 50.33% |
| Net P&L | **−₹21,542** | +₹1,59,072 |
| Profit Factor | 0.42 | 1.03 |
| Return | −2.15% | 15.91% |
| Data basis | Real captured signals + real option exits | Labeled ATM delta proxy on spot, filters auto-disabled, no real premiums |

**Decision rule:** Trust the **−₹21,542 / PF 0.42** figure. The +₹1.59L is an artifact of a delta proxy with option/spread/volume confirmation filters disabled and no theta. A PF of 1.03 on a proxy almost certainly falls below 1.0 once real premiums and theta are modeled. This is consistent with the previously established "thin, fragile pre-theta edge."

---

## Part B — Developer debugging checklist

### B1. Timezone / session-boundary bug (HIGHEST PRIORITY)

**Evidence:** Trades stamped `27 Apr, 04:42 pm IST` (entry AND exit identical), and the audit banner "13 of 86 trades have an entry/exit OUTSIDE 09:15–15:30 IST." 04:42 pm is after market close — these timestamps are wrong, not just out-of-session.

- [ ] Confirm every timestamp is stored in **UTC** in the DB and converted to **Asia/Kolkata** only at the presentation/serialization layer. No naive `datetime` anywhere in the signal/exit path.
- [ ] Grep the codebase for naive datetime construction and string-based time math:
  - `new Date(` without explicit zone handling
  - `toLocaleString` / `toISOString` used for storage rather than display
  - Python: `datetime.now()` (should be `datetime.now(tz=ZoneInfo("Asia/Kolkata"))` or UTC)
- [ ] Add a single canonical helper (`toIST(ts)` / `toUTC(ts)`) and route all conversions through it. Ban ad-hoc conversion.
- [ ] Identical entry==exit timestamps (e.g. both `04:42 pm`) indicate the exit fallback is stamping `signal_time` instead of the real fill/exit time. Trace where `exit_time` is assigned when no captured exit exists — it must be `null`, not a copy of entry.
- [ ] Add a **hard validation gate**: any trade with `entry_time` or `exit_time` outside 09:15:00–15:30:00 IST (on a trading day) is flagged AND excluded from P&L, with the reason logged. The audit banner should be driven by this gate, not computed cosmetically.
- [ ] Regression test (Vitest): feed a signal at 10:45 IST with a captured exit at 15:15 IST; assert stored UTC values round-trip back to the exact IST wall-clock. Add a negative test for a 16:42 timestamp → must be rejected.

### B2. Signal-capture starvation (HIGH)

**Evidence:** "68 taken signals expired or went stale with no captured option exit — excluded from P&L." Real evaluable sample is only **18 of 86**. "No option-chain snapshots captured yet."

- [ ] Confirm the **option-chain ingestor (Mode D capture)** is actually running on Railway and writing snapshots. The note says zero snapshots captured — this is the upstream bottleneck; everything else is gated on it.
- [ ] Verify the ingestor survives Railway restarts and multi-replica conditions (it must not rely on in-memory state — same class of bug as the dedup rings/daily counters previously identified).
- [ ] Add an **ingestor health metric** surfaced on the page: snapshots/day, last-snapshot timestamp, gap detection. If capture stalls, you want to see it immediately, not discover it as missing P&L weeks later.
- [ ] For each "stale/expired, no exit" signal, log **why** the exit wasn't captured (no snapshot at exit time / strike not in chain / expiry mismatch). Right now they silently vanish into the excluded bucket.
- [ ] Until capture is healthy, **label the Real Replay stats "indicative (n<30)"** in the UI so n=18 is never mistaken for a verdict.

### B3. Mass pre-emission rejection (MEDIUM — verify intent vs. bug)

**Evidence:** MEAN_REVERSION rejected ~2,300/index, VOLUME_BREAKOUT ~1,700/index, all `PRE_EMISSION_REJECTED / CONDITIONS_NOT_MET`. Tens of thousands of setups blocked.

- [ ] Instrument the rejection path: for a sample of 20 rejected MEAN_REVERSION setups, log the **exact condition that failed** (which threshold, actual vs. required value). Confirm this is intentional gating and not an always-false predicate (e.g. an RSI band that can never be entered, a sign error, or a unit mismatch).
- [ ] Confirm rejection counts are **deduplicated** — given the prior polling-frequency duplicate storm (44k rows → ~83 unique signals), these counts may be inflated by the same re-evaluation loop. Group by unique setup, not by poll tick.
- [ ] Decide whether such heavy rejection is desired. If MEAN_REVERSION rejects ~99% of setups it may be effectively disabled — either fix the gate or remove the strategy from the registry to stop misleading counts.

### B4. P&L / cost-model integrity (MEDIUM)

- [ ] Re-confirm the **STT fix landed**: 0.15% (post-Apr-2026), not the old 0.0625%. The Research run shows "Include charges (modeled)" and "Include slippage (modeled)" toggled on — verify the charge model in *this build* uses the corrected rate. Inflated P&L from the old rate would flatter the +₹1.59L number further.
- [ ] Verify `optionPrice (ATM-delta-proxy)` and `vwap (session-mean)` are clearly flagged as **modeled, not real** wherever they feed a number (the Research tab already labels this; ensure the Compare tab does too).
- [ ] Confirm "Real Replay never fabricates an outcome" holds in code: a signal with no captured exit must contribute **nothing** to P&L (not a zero, not a proxy) — already stated, worth a unit test.

### B5. Determinism / no duplicate runs (MEDIUM)

- [ ] The run cards show many identical `Real ALL −₹21,542 08 Jun 26 engine replay` entries. Confirm the **dedup-by-input-hash** is working (the banner says "existing result was reused, no duplicate created"). If identical-input runs are still creating new cards, the dedup key is wrong.
- [ ] Make the dedup key persistent (DB-backed), not in-memory, so it survives restarts and multiple replicas.

---

## Part C — Making F&O P&L more accurate (close the proxy gap)

The current positive number is fake-positive because it rests on a spot delta proxy. Accuracy work = replacing every proxy with real, theta-aware option economics.

1. **Real option premiums, not delta proxy.** The single biggest accuracy lever. Finish the option-chain capture so Real Replay uses actual entry/exit premiums. Until then, no P&L number is real. (Mode D capture is the gating item.)

2. **Model theta explicitly.** A directional delta proxy ignores time decay, which is exactly where intraday/positional option buyers bleed. Wire in the theta-aware premium decay model already built. Expect the apparent edge to shrink or invert — that is the truth surfacing, not a regression.

3. **Model IV and IV-crush.** "IV history" is shown as available in Real Replay but "IV unavailable" in Research. Premium = f(spot, time, IV). Without IV you cannot price exits around events/expiry. Capture and apply per-strike IV; model the expiry-day IV crush separately.

4. **Real bid-ask spread, not a flat slippage %.** Index options spreads widen at open, near expiry, and on far strikes. Replace flat modeled slippage with a spread model keyed off moneyness, time-to-expiry, and time-of-day. This is where backtested edges most often die in live trading.

5. **Liquidity / fill realism.** Reject or penalize fills on strikes with thin OI / wide spreads. A backtest that assumes you always get mid-price on any strike is optimistic. Use captured OI ("OI unavailable" currently — capture it).

6. **Expiry-selection discipline in the model.** Your five mandatory conditions already specify next-week expiry for normal trades, current-week reserved for expiry-day strategy. Ensure the backtester actually selects expiries per that rule rather than nearest-expiry-by-default (nearest expiry maximizes theta bleed and flatters/distorts results depending on direction).

7. **Bar-by-bar, no look-ahead.** Confirm the no-look-ahead backtester is what's driving these numbers (decisions use only data available at the bar close, exits evaluated forward). Any look-ahead inflates win rate.

8. **Separate the two engines in the UI permanently.** Rename "Strategy Research" P&L to something like *"Directional proxy — indicative, not tradeable P&L"* and never show it in the same hero stat row as Real Replay. This is an accuracy-of-interpretation fix.

---

## Part D — Making the engine work in your favour (profitability levers)

These are strategy/risk changes, not bug fixes. All remain paper-only and evidence-gated.

1. **Enforce the R:R ≥ 1:1.5 rejection gate — and measure realized R:R.** The Research run used "Min R:R 1.5" yet PF is only 1.03 and Real Replay PF is 0.42. That gap means trades are being entered at 1.5 *target* R:R but exiting at far worse *realized* R:R (stops hit, theta erosion, slippage). Track realized R:R per trade and reject strategies whose realized R:R < required.

2. **Win rate is the problem, not just R:R.** 16.67% real win rate with the current R:R cannot be profitable. Two paths: (a) raise win rate via stricter confluence-only entries, or (b) raise realized payoff on winners via trailing. Do both, but confluence-first.

3. **Confluence-only entries.** Per your mandatory condition: require multiple aligned signals (e.g. VWAP + EMA trend + OI/flow direction) before emission. The blocked-setups table suggests the engine already filters hard — make sure it's filtering on *quality* confluence, not an arbitrary predicate (see B3).

4. **Spot-based trailing stop + profit protection.** Your conditions specify trailing SL on profitable trades and moving stop to T1 once T1 is hit. Confirm these are implemented in the backtester and measure their P&L contribution in isolation (toggle on/off) so you know each is actually helping.

5. **Strategy-level capital allocation.** Per-strategy comparison (Research) shows only **Range/Mean-Reversion Reversal** and **EMA Trend Retest** net-positive on the proxy; ORB, VWAP Pullback, Volatility Compression, and Failed Breakout are net-negative even before theta. Once real premiums are in, **cut or quarantine the losers** rather than running all six. Don't fund a basket whose average is dragged down by structurally negative strategies.

6. **Regime gating.** Avoid-Chop-Zone and Avoid-Last-15-Minutes filters are on. Add explicit regime tags (trending / range / high-VIX) and only let a strategy emit in the regime where it has a measured edge. Mean-reversion in a trend and trend-retest in a range are both losers.

7. **Position sizing by VIX.** Size down when India VIX is elevated (premiums rich, gaps larger). This protects the equity curve's drawdown, which is what kills accounts even when expectancy is positive.

8. **Evidence gate before any capital talk.** Hold the line on the five-phase, evidence-gated roadmap and the 6-month paper period. Concretely, do not even discuss live capital until: (a) ≥ 200–300 *real-exit* decided trades (not proxy), (b) PF > 1.3 *after* theta + real spreads, (c) realized R:R ≥ required, (d) max drawdown within tolerance across at least two distinct market regimes.

---

## Part E — Suggested order of work

1. Fix the IST/session bug (B1) — until timestamps are clean, nothing else is trustworthy.
2. Get the option-chain ingestor capturing reliably on Railway (B2) — unblocks all real P&L.
3. Add IV + OI capture and real spread modeling (C3, C4, C5).
4. Wire theta-aware pricing into Real Replay (C2) and re-baseline every strategy.
5. Audit/clean the rejection logic and dedup the counts (B3, B5).
6. Cut net-negative strategies; keep regime-gated, confluence-only survivors (D5, D6).
7. Accumulate the real-exit sample; re-evaluate against the Part D evidence gate.

---

*Educational / research only — not financial advice. Paper-only until the evidence gate in Part D is cleared.*
