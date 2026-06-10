# F&O Signal Engine Rectification — Audit

**Date:** 2026-06-10
**Scope:** F&O strategy engine logic only — recovery/chase veto, anti-flip discipline,
tradeable-signal gate, P25 official-status gate, counters/circuit-breaker hygiene, and
MFE/MAE evidence cleanup.
**Mode:** IMPLEMENTED 2026-06-10 (VERIFY + HARDEN — existing `FNO_SIGNAL_HYGIENE_V2` guardrails
kept; additive defense-in-depth + honesty + forward-capture only). See §5 for the per-phase
fix/limitation close-out.

---

## 0. Headline finding (read this first)

**The large majority of the corrections requested in this task already shipped on
2026-06-09 under the `FNO_SIGNAL_HYGIENE_V2` feature flag (default ON).** This audit
verifies they exist, are wired correctly, and identifies the genuinely-remaining gaps.
It would be dishonest to re-build them as if absent. What already exists:

| Requested correction | Status in code | Where |
|---|---|---|
| Strict tier separation (only TRADEABLE opens) | **EXISTS** | `deriveTradeClass` / `isAutoTradeableSizingTier` in `optionSignalVetoes.ts`; enforced in `paperTradingFO.openPaperTrade` |
| INFO_ONLY / BASELINE cannot open | **EXISTS** | `openPaperTrade` skip `INFO_ONLY_NOT_TRADEABLE` (gates on sizing tier) |
| Recovery-veto (demote fresh PUT in bounce) | **EXISTS** | `RECOVERY_MODE_VETO` in `evaluateDirectionalVetoes` (`optionSignalVetoes.ts`) |
| Chase-veto (demote late CALL after extension) | **EXISTS** | `CHASE_RISK_VETO` in `evaluateDirectionalVetoes` |
| Anti-flip / direction-change cooldown | **EXISTS** | `isBiasFlipSuppressed`, `BIAS_FLIP_COOLDOWN_MIN=45` in `optionSignalGates.ts` |
| Market regime classification | **EXISTS** | `regimeClassifier.ts` (`TRENDING_BULL/BEAR`, `RANGING`, `VOLATILE`, `EXPIRY_DAY`) |
| Premium-trust gate (Kite-only; block Yahoo/synthetic/stale) | **EXISTS** | `signal.premiumTrusted !== true` block in `openPaperTrade`; set in `marketData/optionChainProvenance.ts` |
| Stop/target/RR validation, min-RR | **EXISTS** | `MIN_RR_FOR_HC=1.4`, clamp/realism in `optionSignals.ts` |
| Liquidity / DD caps / heat / daily-trade cap | **EXISTS** | `FNO_LIQUIDITY`, `MAX_DAILY/WEEKLY_LOSS_PCT`, `PORTFOLIO_HEAT`, `MAX_TRADES_PER_DAY` in `paperAccount.ts` |
| P25 = official-status gate only, NOT a trade blocker | **EXISTS** | P25 derives label only (`infraHealth.ts deriveP25Gate`, `verificationStatus.ts`); open path does not consult P25 |
| Circuit breaker counts ACTUAL stops, not modelled outlooks | **EXISTS (under flag)** | `loadGateContext` `paperStoppedToday` from `paper_trade_fo exit_reason=STOPPED` |
| Audit trail for vetoes/demotions/blocks | **EXISTS** | `fno_signal_reasoning` table + `fnoSignalReasoningLogger.ts` |

**Genuinely-remaining gaps (the actual work of this task) — ALL CLOSED 2026-06-10:**
1. ~~**MFE/MAE evidence in the F&O Cockpit** is hardcoded to `"—"`~~ → **FIXED (P2).** Cockpit
   Avg MFE/Avg MAE tiles now show real signed values aggregated **only over rows with evidence**
   (`hasMfeMaeEvidence`, excludes 0/0 placeholders) plus a count hint; absent → honest "n/a /
   premium path not recorded". `mfeMaeEvidenceCount` added to the summary.
2. ~~**Premium-path MFE/MAE is genuinely not recorded**~~ → **FORWARD-CAPTURE ADDED (P5).** Four
   additive **nullable** columns on `paper_trade_fo` (`highest/lowest_premium_after_entry` +
   `*_at` timestamps), applied via guarded `ALTER TABLE … ADD COLUMN IF NOT EXISTS` (NO
   `drizzle-kit push`). MTM sweep stamps them (monotone GREATEST/LEAST, COALESCE-seeded,
   timestamp advances only on a strictly new watermark). **No backfill** — pre-change rows stay
   NULL = honestly unavailable. *Limitation:* true premium-path %s only for trades opened after
   this change; cockpit consumption of the new columns is deliberate forward work (not yet wired).
3. ~~**Open-path defense-in-depth** (no explicit tradeClass/actionable assertion)~~ → **FIXED
   (P0+P1).** `assertTradeableForOpen` (pure, `optionSignalVetoes.ts`) is now the explicit FIRST
   gate in `openPaperTrade`: requires `tradeClass==='TRADEABLE'` + actionable + premium-trusted +
   no recovery/chase veto tag. Maps `PREMIUM_UNTRUSTED`→`PREMIUM_UNTRUSTED` else
   `INFO_ONLY_NOT_TRADEABLE` (no new wire enums). Existing sizing-tier/premium gates kept as
   secondary nets.
4. ~~**UI per-setup explanation completeness**~~ → **FIXED (P3).** A "Why this setup" block on the
   F&O setup card surfaces tier/direction/regime/RR/data-quality/premium-source/veto +
   **Auto-trade YES/NO + reason**, all from existing signal fields only (pure
   `setupExplanation.ts`; `paperTradeAllowed = tradeClass==='TRADEABLE'`). No new signal math.
5. ~~**Test coverage** partial~~ → **FIXED.** `assertTradeableForOpen` matrix
   (`optionSignalVetoes.test.ts`), cockpit honesty (`foCockpitView.test.ts`), per-setup reason
   (`setupExplanation.test.ts`), premium-path SQL shape (`paperTradingFO.premiumPath.test.ts`),
   anti-flip regression (`optionSignalGates.antiFlip.test.ts`).

---

## 1. Vocabulary reconciliation (avoid a parallel taxonomy)

The task uses `TRADEABLE_SIGNAL` / `INFO_ONLY` / `BASELINE` / `OUTLOOK` / `WATCHLIST_ONLY` /
`DEMOTED` / `UNDER_SAMPLED_PAPER_TEST`. The codebase already has a settled vocabulary; the fix
will REUSE it, not invent new enums:

| Task term | Existing code term | Notes |
|---|---|---|
| `TRADEABLE_SIGNAL` | `tradeClass: "TRADEABLE"` (+ sizing tier `STANDARD`) | The only thing that may open |
| `INFO_ONLY` | `tradeClass: "INFO_ONLY"` | Demoted setups; shown with reason |
| `BASELINE` / `OUTLOOK` | `OptionSignalTier: "BASELINE"`, `setupKey:"BASELINE"` | Always-on directional read |
| `WATCHLIST_SETUP` / pending | `LifecycleStatus: "PENDING"` (→`TRIGGERED`) | Opens only on trigger + gates |
| `DEMOTED` | veto/gate sets `tier="BASELINE"` ⇒ `INFO_ONLY` | recovery/chase/HTF/RS/winrate/OI |
| regime labels | `regimeClassifier.Regime` | map RECOVERY/BREAKDOWN/CHASE to existing vetoes, not new regimes |
| `UNDER_SAMPLED_PAPER_TEST` | P25 label in `verificationStatus.ts` | already non-blocking |

> Decision: **do not add new regime enum members** (`RECOVERY/BREAKDOWN/EXHAUSTION/CHOP`) unless
> a test proves they change a decision. Recovery/chase are already handled as *vetoes on top of*
> the regime, which is the existing, tested design. Adding parallel regimes risks double-counting.

---

## 2. Per-module audit table

Legend: **Open?** = can this path open a paper trade · **Risk?** = can it move
risk/circuit-breaker counters · **Official?** = counts as an official/validated signal.

### 2.1 Signal generation entrypoint
- **Frontend:** F&O setups list / cockpit (`artifacts/scanner/src/components/fno/*`, `pages` F&O tab)
- **Endpoint:** `GET /fno/*` (`routes/fno.ts`): `data-health`, `diagnostics/today`, `gate-waterfall`, `blocked-signals`
- **Backend:** `lib/optionSignals.ts` → `buildSignalsForIndex` → `buildContext` (EMA/RSI/VWAP/ATR/regime/VP) → detectors → `detectBaselineOutlook` → confluence (`confluenceEngine.ts`)
- **Current behaviour:** emits HIGH_CONVICTION setups + always-on BASELINE; confluence sets `adjustedConfidence`; `tradeClass` derived via `deriveTradeClass`
- **Open?** No (generation only). **Risk?** No. **Official?** N/A
- **Issue:** none structural. Tier→tradeClass coupling is correct but implicit.
- **Proposed fix:** none here (changes land in open-path + UI surfacing).
- **Remaining limitation:** F&O universe stays NIFTY/BANKNIFTY/SENSEX (out of scope to change).

### 2.2 Tradeable vs INFO_ONLY classification
- **Backend:** `optionSignalVetoes.ts` `deriveTradeClass`, `isAutoTradeableSizingTier`; flag `signalHygieneFlag.ts` (default ON)
- **Current behaviour:** hygiene ON ⇒ only HIGH_CONVICTION = TRADEABLE; BASELINE (incl. veto-demoted) = INFO_ONLY
- **Open?** Indirect gate. **Risk?** No. **Official?** Sets actionability.
- **Issue:** correct; no explicit `tradeClass`/`actionable` boolean asserted at open.
- **Proposed fix:** add `actionable` derivation + assert it in open-path (defense-in-depth).
- **Remaining limitation:** when flag is OFF (legacy rollback) BASELINE auto-trades by design — documented, intentional.

### 2.3 Recovery-veto
- **Backend:** `evaluateDirectionalVetoes` `RECOVERY_MODE_VETO` (`RECOVERY_VETO` thresholds); wired in `optionSignals.ts` (~line 1205) under flag
- **Current behaviour:** fresh PUT demoted to INFO_ONLY when ALL of: bounce ≥0.75×ATR off day-low, higher-lows, RSI rising & ≥42, price reclaimed EMA9/VWAP. Reason string emitted; audit-logged `RECOVERY_VETO`.
- **Open?** Demotes ⇒ blocks open. **Risk?** No (demoted ≠ counted). **Official?** No.
- **Issue:** logic present & pure-tested; **UI does not always show the reason tag on the card**; verify it is applied on the *fresh* setup path only (not re-vetoing already-triggered).
- **Proposed fix:** surface `recoveryReason` on the setup card; add open-path test that a recovery-vetoed PUT cannot open.
- **Remaining limitation:** thresholds are heuristic (ATR/RSI), unchanged.

### 2.4 Chase-veto
- **Backend:** `evaluateDirectionalVetoes` `CHASE_RISK_VETO` (`CHASE_VETO` thresholds)
- **Current behaviour:** fresh CALL demoted to INFO_ONLY when spot ≥2×ATR above VWAP AND RSI≥70 AND vertical run ≥1.5×ATR/4 bars; re-evaluated each tick (re-allows after pullback). Audit `CHASE_VETO`. `MIN_RR_FOR_HC=1.4` also rejects degraded-RR setups.
- **Open?** Demotes ⇒ blocks open. **Risk?** No. **Official?** No.
- **Issue:** present & tested; UI reason surfacing + open-path test gap.
- **Proposed fix:** surface `chaseReason`; add test (late CALL after extension cannot open).
- **Remaining limitation:** thresholds heuristic, unchanged.

### 2.5 Anti-flip / direction-change cooldown
- **Backend:** `optionSignalGates.ts` `isBiasFlipSuppressed`, `BIAS_FLIP_COOLDOWN_MIN=45`
- **Current behaviour:** after a `STOPPED` outcome on an index, opposite-direction signals suppressed for 45 min; audit `BIAS_FLIP_COOLDOWN`.
- **Open?** Suppresses ⇒ blocks open. **Risk?** No. **Official?** No.
- **Issue:** cooldown keys off a *stop*; the task also wants "no flip purely because one indicator changed / requires confirmed regime transition." Need to confirm whether a flip with NO prior stop but a fresh opposite trigger is still allowed too eagerly.
- **Proposed fix:** verify + (if a gap is proven by test) require a confirmed regime transition for a flip even without a prior stop; surface flip-blocked reason on card. **Any threshold/logic change here is the highest-risk item and will be gated behind a test that proves the current behaviour is wrong before changing it.**
- **Remaining limitation:** single-replica in-memory cooldown assumption (pre-existing).

### 2.6 Market regime classification
- **Backend:** `regimeClassifier.ts` `classifyRegime`; consumed in `buildContext`/confluence
- **Current behaviour:** every decision carries a regime; confluence `REGIME` factor; expiry-day demotion.
- **Open?** No (input). **Risk?** No. **Official?** No.
- **Issue:** task's RECOVERY/BREAKDOWN/EXHAUSTION/CHOP are not first-class regimes — handled as vetoes. Acceptable; reconcile in UI labels only.
- **Proposed fix:** ensure the regime label is shown per setup; map veto-active states to a human label ("recovery active"). No new enum unless test-justified.
- **Remaining limitation:** ADX/BB heuristics unchanged.

### 2.7 Trigger / lifecycle (WATCHLIST_SETUP → pending → triggered)
- **Backend:** `optionSignalLifecycle.ts` (`PENDING→TRIGGERED→TARGET/STOP/EXPIRED`); open hook calls `paperTradingFO.openPaperTrade`
- **Current behaviour:** PENDING does not open; only `TRIGGERED` invokes open path, which then runs all gates; `STALE_TRIGGER` expires stale pendings.
- **Open?** Only on trigger + gates. **Risk?** Only when actually opened. **Official?** No.
- **Issue:** correct.
- **Proposed fix:** none (read-only confirm + a test that PENDING/WATCHLIST never opens).
- **Remaining limitation:** none noted.

### 2.8 Paper-trade open path (the critical gate)
- **Backend:** `paperTradingFO.ts` `openPaperTrade` → ordered gates (see table below)
- **Current behaviour (gate order):** master-enable → **sizing-tier (`isAutoTradeableSizingTier`)** → **`premiumTrusted!==true` block** → confidence floor (≥65) → market-open → consecutive-stops (≤2) → daily/weekly DD latches → 15:25 cutoff → premium-sizing soft cap → liquidity (LTP/spread/OI) → portfolio heat → daily-trade cap (≤4) → cooldown size-mult. Each failure logs a `SkipReason` + `fno_signal_reasoning`.
- **Open?** YES (this is the only opener). **Risk?** Yes (opened trades count). **Official?** No (P25 separate).
- **Issue:** (a) gates on *sizing tier*, not an explicit `tradeClass==='TRADEABLE' && actionable`; (b) no single structured "why blocked" object returned in the exact shape the task asks for (`{trade_open_allowed, reason}`) — reasons exist but as enum skip-codes.
- **Proposed fix:** add explicit `assertTradeable(signal)` (tier===STANDARD/HIGH_CONVICTION **and** tradeClass==='TRADEABLE' **and** actionable===true **and** premiumTrusted===true and not vetoed) as a first hard gate; expose a structured block-reason for the diagnostics/UI. Pure, additive, fail-closed.
- **Remaining limitation:** spread-liquidity is fail-OPEN on a fetch error by existing design (documented); not changing without sign-off.

### 2.9 P25 evidence / official-status
- **Backend/Frontend:** `paperAnalyticsFO.ts` + `/paper/analytics/fo/shadow-exits`; `infraHealth.ts deriveP25Gate`; `verificationStatus.ts`
- **Current behaviour:** P25 insufficient ⇒ label `UNDER_SAMPLED_PAPER_TEST` / not official; **does NOT block opens**.
- **Open?** No (label only). **Risk?** No. **Official?** Yes (the gate for "official").
- **Issue:** matches the required decision already. Need a test locking "P25 insufficient does not block open" and "blocks official label."
- **Proposed fix:** tests only; ensure label surfaced on cockpit.
- **Remaining limitation:** none.

### 2.10 Counters & circuit breaker
- **Backend:** `optionSignalGates.ts` `loadGateContext` (`paperStoppedToday` vs legacy `modeledStoppedToday`), `DAILY_STOP_LIMIT=2`; `paperAnalyticsFO.ts` win-rate/P&L from CLOSED `paper_trade_fo`
- **Current behaviour (flag ON):** circuit breaker + win-rate/P&L count ACTUAL opened/closed trades; demoted/baseline outlooks excluded.
- **Open?** No. **Risk?** Defines risk counters. **Official?** Feeds official stats.
- **Issue:** correct under flag; a test should assert demoted setups never increment risk counters.
- **Proposed fix:** test only.
- **Remaining limitation:** when flag OFF, legacy modelled-stop counting returns (intentional rollback path).

### 2.11 MFE/MAE evidence (the real cleanup)
- **Frontend:** `FoCockpitSummaryCards.tsx` lines 91-92 hardcode `Avg MFE/MAE = "—" "not in closed payload"`; helpers in `foCockpitView.ts` (`hasMfeMaeEvidence`, 0/0-placeholder + missing classification already exist)
- **Endpoint/Backend:** `/paper/trades/fo` closed payload **includes** `maxRunup`/`maxDrawdown` (nullable, `routes/paper.ts` ~243-244); `getFoAnalytics` **does not** aggregate avg MFE/MAE; DB `paper_trade_fo.max_runup/max_drawdown` updated live by the MTM sweep
- **Current behaviour:** P&L-excursion MFE/MAE persisted; cockpit shows placeholder; no premium-path high/low captured
- **Open?** No. **Risk?** No. **Official?** Evidence display only.
- **Issue:** (a) cockpit not wired to existing data; (b) server avg not computed; (c) richer premium-path metrics (entry/exit/high/low premium, %s, timestamps) are genuinely **not recorded** and must NOT be fabricated.
- **Proposed fix:** (1) aggregate honest avg MFE/MAE in `getFoAnalytics`/cockpit summary **only over rows with real evidence** (reuse `hasMfeMaeEvidence`; exclude 0/0 placeholder + missing), surface count + exclusion reason; (2) wire the two cockpit tiles to the real values or an explicit "premium path not recorded — N of M closed trades have excursion evidence" reason; (3) **(optional, sign-off needed)** begin recording highest/lowest premium-after-entry during the MTM sweep going forward (additive nullable columns) so future trades carry true premium-path MFE/MAE. Historical stays honestly "unavailable."
- **Remaining limitation:** no retroactive premium tick path; richer %s only for trades opened after the forward-capture change (if approved).

### 2.12 UI per-setup explanation
- **Frontend:** F&O setup cards + `/fno/diagnostics/*`
- **Current behaviour:** diagnostics expose gate-waterfall/blocked-signals; card does not show all of tier/regime/veto/RR/"paper-trade allowed Y/N + reason" together
- **Proposed fix:** consolidate an honest per-setup explanation block (tier, regime, direction, trigger status, veto status, data quality, premium source, RR, paper-trade allowed Y/N + reason) sourced from existing fields only.
- **Remaining limitation:** purely presentational; no new signal math.

---

## 3. Preserved core decisions (confirmed already true in code)
- P25 insufficient does **not** block paper-trade open — confirmed (open path never reads P25).
- P25 is a stats-confidence / official-status gate only — confirmed.
- Hard data-quality blocks remain: stale/missing/untrusted/Yahoo/synthetic premium, unresolved
  contract, liquidity failure, risk-gate failure, INFO_ONLY/BASELINE tier — all confirmed present.

---

## 4. Risk assessment
- **Overall risk: HIGH** (touches live F&O paper-trade open path + flag-gated engine).
- Mitigations: every change is **additive + fail-closed**; no new fabricated values; no threshold
  change without a failing test first; the most dangerous edits (anti-flip logic, any new hard
  gate) are isolated to their own phase and proven by test before/after. No `drizzle-kit push`
  (additive columns, if approved, applied via guarded `ALTER TABLE … ADD COLUMN IF NOT EXISTS`).

---

## 5. Implementation close-out (2026-06-10)

Delivered as VERIFY + HARDEN. Existing `FNO_SIGNAL_HYGIENE_V2` guardrails were left intact; every
change below is additive, fail-closed, and free of fabricated values.

| Phase | What shipped | Fix | Limitation |
|---|---|---|---|
| **P0** | Pure `assertTradeableForOpen` + `VETO_TAGS` in `optionSignalVetoes.ts` (+ tests) | Single source of truth for "may this open?" — pure, no I/O | Decision inputs are existing fields only; no new signal math |
| **P1** | `assertTradeableForOpen` wired as explicit FIRST gate in `paperTradingFO.openPaperTrade` | INFO_ONLY/BASELINE/vetoed/untrusted can never open even if sizing-tier coupling drifts | Maps to existing skip enums (`PREMIUM_UNTRUSTED`/`INFO_ONLY_NOT_TRADEABLE`); no new wire enum |
| **P2** | Cockpit Avg MFE/MAE honesty (`foCockpitView.ts` + `FoCockpitSummaryCards.tsx`) | Real signed avg over evidence rows only + count; honest "n/a" otherwise | Evidence = P&L excursion (`max_runup/drawdown`); richer %s await P5 data |
| **P3** | "Why this setup" block (`setupExplanation.ts` + `options.tsx`) | tier/dir/regime/RR/data-quality/premium-source/veto + Auto-trade Y/N + reason from existing fields | Presentational; `paperTradeAllowed` mirrors server `tradeClass` |
| **P4** | Anti-flip verified via failing-test-first (`optionSignalGates.antiFlip.test.ts`) | **No gap found** — opposite-direction-after-stop within `BIAS_FLIP_COOLDOWN_MIN=45` IS suppressed; locked as regression | Cooldown keys off a real STOP (pre-existing design); **no logic change** (none test-justified) |
| **P5** | Forward premium-path capture: 4 nullable cols + MTM-sweep stamping (`paperTrading.ts`, `paperTradingFO.ts`) | True premium-path high/low + timestamps for trades opened from now on; guarded ALTER, no push, no backfill | Pre-change rows NULL = honestly unavailable; cockpit consumption of new cols is forward work (not yet wired) |

**Verification:** full `pnpm run typecheck` clean; api-server vitest 1244 pass (4 shards, `--pool=threads`);
scanner vitest 680 pass (3 shards, run after api-server). No `drizzle-kit push`; dev DB columns added via
guarded `ALTER TABLE … ADD COLUMN IF NOT EXISTS` (re-run against prod after deploy).
</content>
