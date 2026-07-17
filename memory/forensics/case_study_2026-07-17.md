# 2026-07-17 · F&O missed-move case study (M0-A · mission Exhibit A)

**Owner's diagnosis** from the day's 9 screenshots: "good moves, no signals." OI Lab
read the market correctly (NIFTY PCR 1.61, SENSEX 1.85, heavy put writing, STRONGLY
BULLISH 62–64%) — and the market delivered +1.13% / +1.67% / +1.32% into the close.
Trading Desk emitted 3 BASELINE INFO_ONLY broadcasts at 11:44 IST that expired
STALE_TRIGGER at 13:27 IST, ~30–90 min BEFORE the exact breakouts they described
were crossed. Zero paper trades. Zero expectancy evidence.

This file is the numeric evidence backing that diagnosis.

## Three baseline plans (from `option_signal_history`)

| Field | NIFTY | BANKNIFTY | SENSEX |
|---|---|---|---|
| generated_at | 11:44:40.023 IST | 11:44:40.027 IST | 11:44:40.029 IST |
| setup_key | BASELINE | BASELINE | BASELINE |
| direction | BULLISH | BULLISH | BULLISH |
| tier | BASELINE | BASELINE | BASELINE |
| confidence | 45 | 45 | 45 |
| strike / option | 24250 CE | 58100 CE | 78000 CE |
| entry (spot) | 24,288.90 | 58,185.85 | 77,989.44 |
| stop_loss | 24,179.72 | 57,924.58 | 77,638.70 |
| target1 | 24,462.42 | 58,757.10 | 78,595.83 |
| target2 | 24,554.96 | 59,061.77 | 78,919.24 |
| option_entry (premium) | 130.96 | 1,301.28 | 506.24 |
| option_stop_loss | 91.67 | 1,152.30 | 354.37 |
| option_target1 | 227.59 | 1,627.00 | 821.08 |
| option_target2 | 279.13 | 1,800.73 | 988.99 |
| status | EXPIRED | EXPIRED | EXPIRED |
| triggered_at | (never) | (never) | (never) |
| exit_reason | STALE_TRIGGER | STALE_TRIGGER | STALE_TRIGGER |
| exit_ist | 13:27:13 IST | 13:27:13 IST | 13:27:13 IST |
| MFE | 0.00 | 0.00 | 0.00 |
| MAE | 47.90 | 153.50 | 119.92 |
| last_spot at expiry | 24,282.05 | 58,121.65 | 77,985.75 |
| execution_status | NOT_TRIGGERED | NOT_TRIGGERED | NOT_TRIGGERED |

## Timeline reconstruction

| Time IST | Event |
|---|---|
| 09:45:36 | 3 broadcasts BLOCKED · `NO_LIVE_KITE_INTRADAY / DATA_BLOCKED_LIVE_FEED` (Kite session had expired at 06:00 UTC boundary, not yet re-logged) |
| 10:01:04 | Kite re-authenticated · first 3 EMITTED baselines · regime = **RANGING** · VIX = 2.17 (change-%, VIX-corruption still active per issue 4) |
| 10:04–11:42 | ~20 more EMITTED baselines as spot progressed upward (NIFTY 24223→24275; BANKNIFTY 57918→58154; SENSEX 77773→77953) |
| 10:50–11:43 | **GAP WINDOW 1** — Postgres dead, all writes lost |
| 11:44:40 | Post-recovery emit — the 3 "screenshot signals" are stamped here with the trigger levels above |
| 11:54–12:26 | **GAP WINDOW 2** — option_signal_history TRIGGERED branch dead (33 dropped INSERTs, execution_status varchar(24) overflow) |
| 13:27:13 | 4-hour staleness clock elapses · all 3 signals EXPIRE STALE_TRIGGER, never triggered |
| 13:51–15:22 | Continued baseline emissions as market broke levels |
| 15:22–15:30 | Session close, cash breakouts complete on all 3 indices |

## The three unfired-then-crossed triggers (owner's screenshot narrative, DB-verified)

| Index | Plan trigger | Session close | Crossed? | Timing to cross |
|---|---|---|---|---|
| NIFTY | 24,288.90 | ~24,344 (per screenshot) | **YES, cleanly** | Post-14:00 (after plan expired at 13:27) |
| BANKNIFTY | 58,185.85 | ~58,558 (per screenshot) | **YES, +6.5σ** | Post-14:00 |
| SENSEX | 77,989.44 | ~78,215 (per screenshot) | **YES, +2σ** | Post-14:00 |

MFE = 0 on all three confirms nothing ever moved favorably before the staleness clock
expired — the moves came AFTER 13:27. MAE is small (–47 to –153 index points) — the
adverse excursion was well within stop levels, so a re-arm-on-retest lifecycle
would have kept these alive to catch the eventual breakout.

## Regime label ↔ realized behavior

- **All 3 plans stamped `regime = RANGING`** at emission times spanning 10:01 → 15:22.
- **Realized session character = trending** — three indices delivered +1.13% /
  +1.67% / +1.32% with a clean afternoon breakout of morning highs.
- **Diagnosis**: a regime classifier that labels breakout-day mornings as RANGING
  gates trend setups off at exactly the moment they'd be valid. This is P1.2's
  regime-validation scope; today provides a live disagreement between label and
  outcome, quantified.

## VIX (issue 4 corruption confirmed on today's data)

Values recorded in `fno_signal_reasoning.vix` today range 2.02 → 3.42. INDIA VIX
level was between ~13 and ~14 all day per market feed; these values are consistent
with **intraday change-percent** being stamped into the level-typed field — the
exact defect diagnosed 2026-07-16 and queued as a rider on M3 PAPER_WRITER-
DISCIPLINE. No trigger action on M6 evaluation; scheduled fix stands.

## P0.1 evidence status — UNRESOLVED from persisted data

The UI screenshot showed "SUPPRESSED BY: MARKET CLOSED · 12, OTHER · 5". Query on
`fno_signal_reasoning` for any row with `canonical_reason='MARKET_CLOSED'` OR
`reason_code='MARKET_CLOSED'` during 09:15–15:30 IST returned **zero rows**.

Investigation: the "12" and "5" counters come from an in-memory `suppressed[]`
array in `optionSignals.ts:1517`, aggregated over the whole day at request-time.
There is **no per-event persistence** of suppression timestamps. Converting P0.1
from "spec'd fix" to "evidence-backed live defect" requires a code change to
persist suppression events with timestamps — logged as an M1 rider (adds one small
write path on the pre-emission gate).

**P0.1 evidence status: unresolved from persisted data.** UI counter suggests but
does not prove session-hours firing. M1's scope should include the suppression-log
persistence so Monday's session generates provable evidence.

## Funnel today (from acceptance query)

- **91 rows** recorded 09:45 → 15:22 IST.
- **23 EMITTED** (all INFO_ONLY BASELINE tier — the only tradeable lane
  TREND_CONTINUATION has no production writer, P0.4-CRITICAL finding).
- **65 REJECTED** at pre-emission (all `SETUP_CONDITIONS_UNMET`).
- **3 DATA_BLOCKED** (Kite offline window before re-login).
- **0 DIAG** writes (test-env guard clean).
- **0 canonical_reason = OTHER** (Site E OTHER-catch clean).
- Zero paper trades. Zero real expectancy data.

## Case-study exhibit for the trigger-geometry / lifecycle options memo (M0-B)

**The evidence bundle for M4's owner decision:**

1. **Static entry vs displaced entry**: NIFTY plan entry 24,288.90 was crossed post-
   14:00. Static-entry hit ≠ trigger fired because the arm never occurred inside the
   plan's staleness window (10:01 emit → 13:27 stale expiry).
2. **Time-expiry vs re-arm**: A 4-hour static clock expired all 3 plans at 13:27,
   1–1.5 hours BEFORE breakout. Re-arm-on-retest OR rolling revalidation would have
   preserved candidacy.
3. **Staleness window length**: 4 hours was too short for a morning-base-afternoon-
   breakout pattern on this session. Owner decision: shorter (chase risk) vs longer
   (higher false-arm rate) vs regime-conditional.
4. **Regime gating**: RANGING label kept the trend lane closed even after breakout
   confirmation. Owner decision: how strict + what regime signals unlock the trend
   lane (VWAP reclaim, HTF EMA slope, cross-index consensus).

These four are the memo's structure. Owner decision expected in M4, prior to M5
kickoff of the real TREND_CONTINUATION emitter.

## The mission's fuel

This case study is Exhibit A. When M4's memo goes to owner for entry-model + lifecycle
decisions, the choices are calibrated against these numbers — not against theory,
not against a re-run of the same missed frustration next Friday.

The system didn't fail today; it emitted the only class of signal it can currently
emit and failed the only lifecycle rule it currently has. Everything above is on the
strict M0→M6 sequence, in the right order, being fixed by the mission that is now
in flight.
