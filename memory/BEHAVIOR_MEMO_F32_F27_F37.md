# Behavior Memo: F-32, F-27, F-37
**Prepared:** 2026-07-18 (R0 re-baseline, Ruling B)
**Status:** Hold as-deployed; owner ratifies or reverts before Monday 09:15 IST
**Scope:** Factual description only — no evaluation, no recommendation

---

## F-32 — Event Blackout Gate

### What was changed
A new hard-block gate was added in `openPaperTrade()` in
`artifacts/api-server/src/lib/paperTradingFO.ts` (lines 431–446).

On every paper FO auto-open attempt the gate checks `isEventBlackoutDay(todayIst)`, which
consults a static calendar declared in `paperAccount.ts`.

### What it suppresses
**All new paper FO auto-opens** on any calendar blackout date.

- Index: ALL (NIFTY, BANKNIFTY, SENSEX)
- Direction: ALL (BULL and BEAR)
- Tier: ALL (HC and BASELINE)
- Confidence: ALL

Existing open positions are NOT touched — they settle naturally through the normal
force-exit / stop-loss / expiry flow.

### When it triggers
`isEventBlackoutDay(istDate)` returns `{ blocked: true, label }` when `istDate` matches
any entry in `EVENT_BLACKOUT_DATES`.

**Calendar (complete list as declared):**

| Date | Label |
|---|---|
| 2026-04-09 | RBI MPC Apr 2026 |
| 2026-06-06 | RBI MPC Jun 2026 |
| 2026-08-06 | RBI MPC Aug 2026 ← next firing date |
| 2026-10-08 | RBI MPC Oct 2026 |
| 2026-11-01 | Diwali Muhurat 2026 (approx) |
| 2026-12-04 | RBI MPC Dec 2026 |
| 2027-02-01 | Union Budget 2027 |
| 2027-02-05 | RBI MPC Feb 2027 |
| 2027-04-09 | RBI MPC Apr 2027 |
| 2027-06-04 | RBI MPC Jun 2027 |
| 2027-08-06 | RBI MPC Aug 2027 |
| 2027-10-08 | RBI MPC Oct 2027 |
| 2027-10-21 | Diwali Muhurat 2027 (approx) |
| 2027-12-03 | RBI MPC Dec 2027 |

### Can it suppress a STRONG_BUY the pre-feature platform would have traded?
**YES.** On any of the 14 listed dates, ALL FO paper auto-opens are blocked regardless of
signal quality, tier, or confidence. The pre-feature platform would have auto-traded any
qualifying signal on those days.

### Live / at-risk sessions
- July 14 (Mon): F-32 was NOT yet deployed (deployed during this session)
- July 15–18 (Tue–Fri, then weekend): market open Tue–Fri; F-32 was live
- Blackout dates in that window: NONE (2026-08-06 is the next firing date, 19 days away)
- **Net live suppression to date: ZERO** — no blackout date fell in the live window

### Skip reason recorded
`EVENT_BLACKOUT` — visible in audit panel. Once-per-IST-day logging via
`blackoutWarnedDates` Set prevents log flooding.

---

## F-27 — Direction-Independent Detector Cooldown

### What was changed
The cooldown map key in `optionSignals.ts` was changed from direction-specific to
direction-independent.

**Before F-27:**
```
Key = "setupKey|index|direction"
Effect: only the same (index, setupKey, direction) triple is suppressed for 30 min
```

**After F-27:**
```
function cooldownKey(setupKey: string, index: string): string {
  return `${index}::${setupKey}`;      // direction intentionally excluded
}
Effect: BOTH directions share one cooldown slot per (index, setupKey) for 30 min
```

DETECTOR_COOLDOWN_MS = 30 minutes (unchanged).

### What it suppresses
When a setup fires on a given (index, setupKey) in either direction, a subsequent signal
for the **same (index, setupKey) in the OPPOSITE direction** is now also suppressed for the
30-minute cooldown window.

- Index: the same index only
- Direction: BOTH directions blocked after first emit
- Scope: only the detector emit phase (`evaluateSignals` / `runSignalSweep`); does not
  affect session-level signal locks which remain direction-specific

### When it triggers
After any successful emit (HC or BASELINE, any confidence) for a given (index, setupKey),
both directions are on cooldown for 30 minutes. Applies to HC signals (hard block) and to
BASELINE/demoted signals (also blocked per lines 1839/1855 in `optionSignals.ts`).

### Can it suppress a STRONG_BUY the pre-feature platform would have traded?
**YES, in a narrow scenario.** If a BEARISH setup fires for NIFTY at 10:00 and a BULLISH
setup for the same setupKey fires at 10:20, the pre-feature platform would have emitted
both. F-27 suppresses the 10:20 BULLISH because the shared cooldown slot is occupied.

### Live / at-risk sessions
- Deployed during this session; live July 15–18 (Tue–Fri)
- Cooldowns are in-memory (process-local Map); reset on server restart
- During normal sessions (signal sweeps every ~60–90s), same-setupKey opposite-direction
  signals within 30 min are uncommon but possible at high-activity moments
- **Retrospective audit:** Would require comparing Jul 15–18 signal logs against the pre-F-27
  key logic. No evidence of suppression in available data.

---

## F-37 — Swing Regression Baseline Gate

### What was changed
A new module `artifacts/api-server/src/lib/swingRegressionGate.ts` was created with
`checkSwingRegressionBaseline()` that computes 90-day autonomous equity paper trade metrics.

### CRITICAL FINDING: F-37 is NOT wired into the auto-open execution path

`checkSwingRegressionBaseline()` is called from exactly one location:

```typescript
// artifacts/api-server/src/routes/paper.ts:1999
router.get("/paper/swing-regression", requireOwner, async (_req, res, next) => {
  const { checkSwingRegressionBaseline } = await import("../lib/swingRegressionGate");
  const result = await checkSwingRegressionBaseline();
  return res.json(result);
});
```

It is a **read-only diagnostic endpoint** (`GET /paper/swing-regression`, owner-only). It is
NOT called from `openPaperTrade()`, `tryOpenPaperTrades()`, `runEquityPaperTradingTick()`,
or any other execution-path function.

### What it suppresses
**Nothing currently.** The gate is a pure diagnostic observer.

### Can it suppress a STRONG_BUY the pre-feature platform would have traded?
**NO** — the gate is not wired to any execution path. It cannot block any trade.

### Current metric values
- tradeCount in 90-day window: **0** (candle warehouse is empty; no equity paper trades
  exist here — this Replit environment has no historical trade data)
- Gate result: `ok: true` (trivially passes because tradeCount < MIN_SAMPLE=10)

### Config (for reference when it is wired):
```typescript
LOOKBACK_DAYS: 90, MIN_SAMPLE: 10, WR_FLOOR: 0.45, PF_FLOOR: 2.0
```

---

## Summary Table

| Feature | Execution-path wired? | Can suppress paper trades? | Net suppression Jul 15–18 |
|---|---|---|---|
| F-32 Event Blackout | YES — `openPaperTrade()` | YES (on 14 listed dates) | ZERO (no blackout date in window) |
| F-27 Direction-independent cooldown | YES — `runSignalSweep()` | YES (narrow: same-setupKey opposite-direction within 30 min) | Unknown (requires log audit) |
| F-37 Swing Regression Gate | NO — diagnostic route only | NO | ZERO |

---

## Questions for owner ratification

**F-32:** Do the 14 calendar dates reflect the intended blackout policy? Are there dates that
should be added or removed? Is blocking ALL tiers on RBI MPC days the right posture, or
should BASELINE be treated differently?

**F-27:** Is direction-independence the intended cooldown semantic? The original direction-
specific cooldown was designed to prevent rapid re-fire of the same setup in the same
direction. The F-27 change also blocks the opposite direction, which is a new constraint.

**F-37:** The module exists and passes tests (42 pass). Should it be wired into the equity
paper auto-open execution path, and if so, should it be a hard-block or a warn-only gate?
Currently it has zero execution effect.
