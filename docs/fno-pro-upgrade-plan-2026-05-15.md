# P13 — Production-vs-Proposed Logic Map + F&O Pro Upgrade Plan
**Date:** 2026-05-15
**Type:** Read-only deliverable per the Final Coder Handoff Pack. **No code modified.**
**Pain context from operator:** F&O paper trader is hitting stop-loss ~50% of the time; signals are not producing the expected edge.
**Companion docs:** `trading-logic-audit-2026-05-15.md` (the underlying read-only audit), Final Coder Handoff Pack (operator's brief).

---

## §0. Two-prompt conflict — needs your decision before any code change

You have two attached prompts that disagree:

| Source | Stance | Key quote |
|---|---|---|
| **Final Coder Handoff Pack** (the doc you pasted) | Conservative, plan-first | *"This is NOT permission to rewrite trading logic immediately. First provide a verified implementation plan and then implement only the explicitly approved priority."* + 7 explicit guardrails ("Do not rewrite F&O signals without approval", etc.) |
| `Coder_Implementation_Prompt_1778834264606.txt` (sibling file) | Aggressive, sweep | *"Convert the current prototype trading database/website into a professional Indian Market Intelligence + Trading Decision Platform"* — lists P0-P5 with broad rewrites (regime classifier rebuild, backtesting engine, 5 new dashboards, instrument master, FII/DII reconciliation) |

I am following the **Handoff Pack** because (a) it is the document you sent me in this turn, (b) its guardrails are explicit and dated 2026-05-15, and (c) charging into a sweeping rewrite while you have a 50% stop-out problem could make the win rate worse, not better.

**If you want the aggressive sweep instead, say so explicitly and we'll re-plan.** Otherwise I assume the Handoff Pack governs.

---

## §1. Production truth (verified, file:line)

This re-confirms the audit findings, scoped to what the Pro F&O upgrade actually depends on.

| Subject | Status in production | Source |
|---|---|---|
| F&O indices | NIFTY, BANKNIFTY, SENSEX only | `optionSignals.ts:51`, `oiLab.ts:49`, `optionSignals.ts:64` |
| F&O setups | TREND_CONTINUATION, VWAP_RECLAIM, VOLUME_BREAKOUT, EMA_PULLBACK, MEAN_REVERSION, BASELINE | `optionSignals.ts:589-947` |
| Confluence engine | `lib/confluenceEngine.ts:scoreConfluence` — replaces per-detector confidence | `optionSignals.ts` references |
| Tier mutation | HC_EMISSION_FLOOR=65, MIN_FNO_TRADE=65, BASELINE 55-64 | `optionSignals.ts:518`, `tradingConfig.ts` |
| Post-emission gates | 13 gates (liquidity, vol-clamp, HTF, 1h HTF, noise, expiry, RS, win-rate, ATM-OI, cooldown, regime, heat, baseline-guardrails) | `paperAccount.ts` constants + `paperTradingFO.ts` flow |
| Strike selection | ATM via `nearestStrike(spot, strikeStep)` — no OTM offset | `paperTradingFO.ts:1155` |
| Direction → option type | `BULLISH→CALL`, `BEARISH→PUT` | `paperTradingFO.ts:1220` |
| P&L formula | `(exitPremium − entryPremium) × lots × lotSize` — **no slippage, no charges** | `paperTradingFO.ts:1079` |
| Partial booking on T1 | **NOT implemented**. `TARGET1_HIT` is a non-terminal status that just records a hit | `optionSignalLifecycle.ts:215` |
| Mark-to-market | Live `fetchOptionChain()` on every read/close | `paperTradingFO.ts:1232` |
| 15:20 force-exit | `forceCloseAllOpenFnoFor1520`, latched once per day | `paperTradingFO.ts:1370` |
| Missed-signal log | **In-memory 100-row ring buffer**, not persisted | `paperTradingFO.ts:317` |
| Option-chain snapshots | **Write-only**, not consumed by any signal/gate | schema header + `optionSnapshotAnalytics.ts:19` |
| Candle warehouse | **Write-only**, not consumed by any signal/scanner | `candleWarehouse.ts:15` |

## §2. Proposed-vs-actual map (per Handoff Pack point 9)

Your prompt asks: *"Verify whether the new F&O setup from files.zip is actually wired into the production paper-trade path: `computeBias()` → `directorFor()` → `gateSignal()` → paper trade insert."*

### §2.1 Search results

| Symbol | Found in `.ts` codebase? | Where |
|---|---|---|
| `computeBias` | **No** | — |
| `directorFor` | **No** | — |
| `gateSignal` | **No** | — |
| `biasEngine` | **No** | — |
| `setupDirectors` | **No** | — |

The only `computeBiasScore` exists in `artifacts/scanner/src/components/home/index-tabs.tsx:37` — it's a **UI helper for the indices-tab visual badge**, completely unrelated to F&O signal generation.

### §2.2 Where the "proposed" architecture actually lives

It lives **inside the Handoff Pack docx as a Pine Script (TradingView indicator)** — approximately 400 KB of Pine code embedded as Appendix Z source-file inventory references. The Pine script defines `setupBias`, `setupScore`, `setupDirection`, `setupTrigger`, `setupInvalidation` as Pine `var`/function-style state. **None of this has ever been ported to TypeScript or wired into the F&O signal engine.**

### §2.3 What this means

- The audit-positive observation is real: nothing in the codebase pretends to be the proposed bias-engine. There is no abandoned half-port, no dead code, no shadow path.
- The **`files.zip` referenced in your prompt is not present in `attached_assets/`** — I cannot inspect any TypeScript port that may have been intended. If you have a zip with proposed `.ts` files, please attach it; otherwise the Pine Script is the only proposed-architecture artefact.
- A "port the Pine setup engine to TypeScript" is therefore a **green-field implementation**, not a wiring exercise.

---

## §3. Why the 50% stop-out rate is unsurprising — root-cause hypotheses (ordered by likelihood)

Each of these is grounded in code we audited; each is a hypothesis until measured.

| # | Hypothesis | Evidence | If true, what changes |
|---|---|---|---|
| **H1** | **Reported P&L overstates true edge by 5-15%** because slippage + brokerage + STT + GST are not modeled. A "50% win rate" by raw premium-difference can be a 40% net win rate after costs. | `paperTradingFO.ts:1079` — formula has no cost terms. NIFTY round-trip ~₹50-80/lot. | Does not change signals, but changes how you judge them. **Lowest-risk fix.** |
| **H2** | **No T1 partial booking + no trail-to-breakeven** means trades that touch T1 then reverse give back unrealised gains and stop out. With a 1.5R-2R typical T2, a setup that hits T1 ~70% of the time can still register 40-50% net stops. | `optionSignalLifecycle.ts:215` — `TARGET1_HIT` is non-terminal, no action taken. | Reduces stop-outs significantly **for trades that touched T1**. Requires lifecycle change. |
| **H3** | **No option-chain confirmation** in entry. A bullish setup can fire when ATM CE has weak OI / wide spread / strong PE buildup — i.e. the option market disagrees with the spot setup. | `paperTradingFO.ts:1052` triggers entry on spot crossings; only LIQUIDITY (LTP/spread/OI) is checked, not directional OI confluence at the strike. | Could reduce false bullish/bearish opens. **Highest variance fix** — needs shadow-mode measurement first. |
| **H4** | **Vol-clamped stop demotion + 1.5× rejection** may be culling the *good* trades. If wide-stop setups are the ones that survive the regime, demoting them to BASELINE means smaller size on the winners. | `optionSignals.ts:481-498`, `VOL_CLAMP_REJECT_RATIO=1.5`. | Recalibration only; needs win-rate-by-stop-width data. |
| **H5** | **Win-rate gate fails-OPEN below `MIN_SAMPLE=10`** means new or rare setups get STANDARD-tier sizing without any expectancy proof. | `paperAccount.ts:272` `WIN_RATE_CALIBRATION { MIN_SAMPLE: 10 }`. | Conservative fail-CLOSED would shrink early-stage exposure. |
| **H6** | **MEAN_REVERSION fires counter-trend** with `RSI < 25` / `RSI > 75`. In a strong trending regime these conditions can persist for hours and the mean keeps moving away. | `optionSignals.ts:885`. | Disabling MEAN_REVERSION when `regime === "TRENDING"` is a low-risk gate addition. |

**You cannot pick the fix without the data.** Every one of these is plausible. The codebase does not currently have the persistent, queryable diagnostics required to disambiguate them. **This is why P14 (signal reasoning logger) is the right first move — it instruments the system so you can *see* which hypothesis is true.**

---

## §4. Phased implementation plan (per Handoff Pack §"Recommended F&O Upgrade Priorities")

Each row is scoped to **one approved priority** with concrete files, what changes, what stays the same, what tests, and rollback.

### P13 — Production-vs-proposed logic map (THIS DOCUMENT)
- **Type:** Read-only report.
- **Status:** ✅ Delivered (this file).
- **Code change:** None.
- **Decision needed from you:** Approve P14 (recommended) or another priority.

### P14 — F&O signal reasoning logger (RECOMMENDED NEXT)
- **Type:** Diagnostics-only. No signal change. No paper-trade change. No schema change to existing tables.
- **What it does:** Persist every emitted-or-rejected signal with: bias components, setup result, gate-by-gate verdict (which gate fired, with values), tier (HC/BASELINE), final decision (EXECUTABLE / WATCH / DEMOTED / REJECTED), and the underlying-spot/option-premium/spread/OI snapshot at decision time.
- **Why first:** Without this data, **any signal change is guessing**. With this data, after one week we can quantitatively rank H1-H6 above and pick the right next change.
- **New table:** `fno_signal_reasoning` (additive only — does NOT touch `option_signal_history` or `paper_trade_fo`).
- **Files touched:** `lib/db/src/schema/fnoSignalReasoning.ts` (new), `paperTradingFO.ts` (one new helper call at decision points), one new diagnostic route, one panel on `/infra-health`.
- **Files preserved untouched:** `optionSignals.ts`, `optionSignalGates.ts`, `confluenceEngine.ts`, `oiLab.ts`, `optionChain.ts`, all sizing constants, all paper-trade execution paths.
- **Tests:** new vitest suite that asserts every gate in §1 row 5 writes a reasoning row.
- **Rollback:** drop the new table; remove the helper call. Zero impact to live trading.
- **Operator burden:** review the new dashboard panel after 1 trading week.

### P15 — Option-chain confirmation **shadow mode**
- **Type:** Read-only / shadow. Does NOT block trades.
- **What it does:** For every emitted F&O signal, compute a CE/PE confirmation score from the live option chain (PCR at ATM±3, OI buildup direction at ATM, spread, IV skew). Persist the score alongside the P14 reasoning row. Add a column to the diagnostic showing "would this signal have passed/failed confirmation?". **No gate is added.**
- **Why second:** With 1-2 weeks of shadow data we can measure: *"do signals with confirmation-pass have a higher win rate than confirmation-fail?"* — then decide whether to promote to a hard gate.
- **Files touched:** New `lib/optionChainConfirmation.ts`, one helper called from `paperTradingFO.ts` decision point. Reuses existing `fetchOptionChain` — no new API calls per tick if the chain is already pulled for liquidity.
- **Files preserved untouched:** signal generation, gates, sizing, execution.
- **Tests:** unit tests on the pure confirmation function with fixture chains.
- **Rollback:** stop calling the helper; column stays in the reasoning table as historical data.
- **Operator burden:** review the win-rate split after 2 trading weeks.

### P16 — Premium-level execution audit
- **Type:** Data correctness audit + report. May propose a fix.
- **What it does:** Verify every trade in `paper_trade_fo` has correct entry_premium, exit_premium, lot_size, stop_premium, target premium, MFE/MAE. Quantify the slippage/charges gap (H1).
- **Files touched:** Read-only audit; one new SQL diagnostic route.
- **Decision after audit:** Whether to add a charges/slippage model to P&L (H1 fix). This would be a separate priority (call it P16b) requiring your explicit approval.

### P17 — Strike/liquidity selector audit
- **Type:** Read-only audit.
- **What it does:** For every recent open, log: strike chosen, ATM offset, IV, OI, spread, distance to expiry, and whether a slightly ITM strike would have been preferable. Identifies whether the ATM-only policy is the right default.
- **Files touched:** Diagnostic route + report doc. No code change to the selector itself.

### P18 — Partial booking on T1 + trail-to-breakeven (H2 fix)
- **Type:** Strategy change. **Highest impact / highest risk** in the sequence.
- **Requires:** P14 + P15 data showing T1 hit-rate ≥ 60%; explicit owner approval per the Handoff Pack guardrail.
- **What it does:** When T1 is hit, close 50% of position, trail stop to entry on the remaining 50%, exit remaining at T2 or trail-stop.
- **Files touched:** `optionSignalLifecycle.ts:215` (currently a no-op for TARGET1_HIT), `paperTradingFO.ts` (new `partialClosePaperTrade` function), `paper_trade_fo` schema (one new column `partial_closed_at_t1` + one new audit row type).
- **Why this comes after P14:** Without the reasoning logger we can't measure whether T1 partials would have helped (i.e. how often trades touch T1 then reverse to stop).

### P19 — Setup expectancy database
- **Type:** Performance analytics, additive.
- **What it does:** Persist setup-by-setup outcomes (R-multiple, MFE, MAE, time-of-day bucket, regime context, expiry context). Used to feed the win-rate gate (H5) with real data and to surface "best/worst setup × regime" reports.
- **Files touched:** New table; reads from `paper_trade_fo` close events; surfaces in `/infra-health` or new `/strategy-performance` page.

### P20 — Backtest / walk-forward harness
- **Type:** Research. Not gating any priority above.
- **Defer until P14-P19 are running.**

### Out of scope (per Handoff guardrails)
- Connect option snapshot analytics as a hard gate (must be shadow-validated first).
- Connect candle warehouse to swing scanner (must be accuracy-compared first).
- Modify Kite order/execution.
- Modify swing scoring (separate priority required).
- Modify schema beyond additive new tables.

---

## §5. Recommended sequence and rationale

```
P13 (this doc)  ✅
   ↓ approve
P14 — Reasoning logger             [1 week of data → ranks H1-H6]
   ↓ approve
P15 — OC confirmation SHADOW       [+1-2 weeks → quantifies H3 value]
   ↓ approve
P16 — Premium-level audit          [confirms or refutes H1]
   ↓ approve (with optional P16b for charges model)
P17 — Strike selector audit        [diagnostic only]
   ↓ approve
P18 — T1 partial + trail BE        [highest-impact strategy change; requires P14 evidence]
   ↓ approve
P19 — Expectancy DB                [feeds smarter win-rate gate]
   ↓
P20 — Backtest harness             [research; optional]
```

**The single most important property of this sequence:** every change is additive, every change is measured before the next is approved, and the live trading path stays intact until P18 (which is gated on evidence from P14-P15).

This is the opposite of "rebuild signals from scratch and hope". It's "instrument first, measure, then change one thing, measure, then change the next thing".

---

## §6. What I am NOT doing in this turn (scope discipline)

| Action | Reason |
|---|---|
| Rewriting any signal | Handoff guardrail #1 + your 50% problem isn't yet diagnosed |
| Modifying any gate | Handoff guardrail; need P14 data to know which gates to touch |
| Changing sizing constants | Handoff guardrail; need P19 expectancy data |
| Connecting option-snapshot analytics as a hard gate | Handoff guardrail explicitly forbids ("Do not connect option snapshot analytics into live signal approval as a hard gate until shadow results are reviewed") |
| Connecting candle warehouse | Handoff guardrail ("Only connect after old-vs-new candle comparison and regression tests") |
| Modifying paper-trade execution | Handoff guardrail #3 |
| Touching swing scoring | Handoff guardrail #5 |
| Modifying schema | Handoff guardrail #6 (additive new tables only, with rollback documented, after approval) |
| Porting the Pine Script "setup engine" to TypeScript | Not in P13-P20. Would be a separate massive priority requiring a whole new design doc |

---

## §7. Decisions I need from you before the next turn

Please answer these as a numbered list:

1. **Two-prompt conflict** (§0): Do I follow the Handoff Pack guardrails (recommended) or the broader Coder_Implementation_Prompt P0-P5 sweep?

2. **Approve P14 (signal reasoning logger)?** This is my recommended next priority. Diagnostics-only, additive table, fully reversible, gives you the data to choose between H1-H6 with evidence instead of guesswork. Estimated ~1 day of build + 1 week of data collection before P15.

3. If not P14, **which priority do you want first?** Pick from P15-P20 above, or describe a different scope.

4. **`files.zip`** — your prompt references "the new F&O setup from files.zip". I cannot find any zip in `attached_assets/`. Was a TypeScript port supposed to be uploaded? If yes, please re-attach.

5. **Pine-Script port** — do you want, separately from P13-P20, a planning doc for porting the Pine "setup engine" (~400 KB of Pine code in the Handoff appendix) to TypeScript? If yes, that becomes its own priority track (call it PS1-PS5) and should be planned before P14 only if you believe the Pine setup engine is a strict superset of what we already have. My quick read says it is **not** a strict superset — our current 6 setups already cover trend continuation, VWAP reclaim, EMA pullback, volume breakout, mean reversion. The Pine "bias engine" is a richer scoring framework but it's not obviously better than our Phase 3 confluence engine without backtest evidence.

6. **Aggressive cost-of-error preference** — your pain is real. Are you willing to accept **2 weeks of measurement (P14 + P15 shadow data) before any signal change**, or do you want me to take a more aggressive single-shot fix on H1 (charges model — cosmetic to win rate but real-money-honest) or H2 (T1 partial booking — actual strategy change) right now? My strong recommendation is the measurement path; I will execute either if you choose.

---

*This document is a code-grounded planning deliverable. No code was modified. Every claim about production code traces to a file:line in §1. The proposed architecture is identified as Pine Script (not TypeScript) in §2. The 50% stop-out problem is decomposed into 6 testable hypotheses in §3 with the recommendation that we measure before we change.*
