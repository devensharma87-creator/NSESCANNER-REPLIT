# F&O Audit Report — 2026-06-05

**Scope:** Full audit of the F&O (index options) paper-trading pipeline + delivery of additive, read-only operator diagnostics. Autonomous mode: safe read-only audit + additive diagnostics only. **No trading-logic, schema, scheduler, or auto-trading changes were made.** Any change touching realized P&L, DD/heat caps, risk gates, entry/exit/stop/target/sizing, schema, or auto-trading is listed under "Proposed (PAUSED — needs sign-off)" and was **not** implemented.

Method: code-grounded trace of `artifacts/api-server/src` (detectors → gates → entry → stop/target → exit → MTM → P&L), cross-checked against the durable `fno_signal_reasoning` audit table and the existing `/paper/diagnostics/*` surface.

---

## A. What shipped this session (additive, read-only)

### A1. STT correction in the shadow cost model (Phase 1, prior checkpoint)
`fnoCostModel.ts` STT rate corrected. **Shadow/reporting-only** — it does NOT feed realized P&L, DD, or heat (those remain GROSS by design). +5 tests. This is a reporting-accuracy fix, not a trading-logic change.

### A2. New consolidating F&O diagnostics namespace `/api/fno/*` (owner-only)
A thin DRY facade over **existing** real data sources. Zero new analytics math; pure re-shaping lives in `lib/fnoDiagnosticsFacade.ts` (9 unit tests). Routes in `routes/fno.ts`, mounted in `routes/index.ts`. Follows the existing `/paper/diagnostics/*` convention (raw `res.json`, not OpenAPI-typed) so no codegen was required.

| Endpoint | Purpose | Delegates to |
|---|---|---|
| `GET /api/fno/data-health` | One-call F&O-scoped live health: Kite session/feed, per-index spot + chain freshness, ATM-leg liquidity (informational), market-context analytics (PCR/max-pain/ATM-IV/bias). Fails soft per section. | `kiteAuth`, `kiteFeed.feedStatus`, `kiteIndexQuotes`, `optionChain.fetchOptionChain`, `optionAnalytics.computeAnalytics`, `fnoSignalReasoningLogger.getReasoningLoggerHealth` |
| `GET /api/fno/diagnostics/today` | Today's (IST) operating snapshot: decisions funnel, demotions, no-trade reasons, open positions, logger health. | `fnoReasoningAnalytics`, `paperTradingFO.getMissedSignals`, `paperTradeFoTable` |
| `GET /api/fno/diagnostics/gate-waterfall` | Ordered decision funnel + demotion/rejection breakdown + honest conversion rates. | `computeReasoningAnalytics` → `buildGateWaterfall` |
| `GET /api/fno/diagnostics/no-trade-reasons` | Durable (persisted) rejections/demotions merged with the ephemeral missed-signal ring, each tagged with explicit provenance. | `computeReasoningAnalytics` + `getMissedSignals` → `buildNoTradeReasons` |
| `GET /api/fno/diagnostics/setup-performance` | Per-setup outcome view (emitted/opened/wins/stops/expiry + decisive win-rate + avg confidence/confluence). | `computeReasoningAnalytics` → `buildSetupPerformance` |

All 5 return **401** unauthenticated (owner-gated). Honest-by-construction: conversion/win rates are `null` (not 0) when denominators are zero; freshness is `"unavailable"` when no timestamp exists; realized-P&L-per-setup is explicitly deferred to `/api/paper/analytics/fo/shadow-costs` rather than fabricated.

**Verification:** full `pnpm run typecheck` green; api-server **904/904**; scanner **554/554**.

---

## B. Gap analysis (what already existed)

The audit confirmed an **extensive** F&O diagnostics surface already exists under `/paper/diagnostics/*`, backed by the durable `fno_signal_reasoning` table and `computeReasoningAnalytics`. The user's requested views (gate-waterfall, no-trade-reasons, setup-performance) were therefore implemented as **re-shaping delegations**, not new computation, to avoid drift from the source of truth. The genuinely new value is the **consolidation** (`/data-health` and `/today` answer "is the F&O machine healthy and what did it do today?" in one call each) and the **explicit provenance labelling** (durable DB vs. restart-volatile ring).

---

## C. Pipeline audit (items 6 & 7) — findings

Severity: **P1** = correctness/data-integrity risk worth fixing; **P2** = accuracy/observability gap; **P3** = note/by-design. None were changed this session.

### Data pipeline
- **Spot:** `getKiteIndexQuotes` (WebSocket tick cache via `kiteFeed.getLiveQuote`, 3s staleness → REST `getQuote` fallback). Sound.
- **Option chain:** `fetchOptionChain` → Kite first, NSE direct fallback (`nseFetch`, cookie jar refreshed every 25 min), Yahoo spot fallback. Sound layering.
- **[P2] NSE-fallback `ltpChgPct` distortion** (`optionChain.ts` ~L384): NSE does not return a per-leg `prevClose`; it defaults to spot, which can distort the option leg's `ltpChgPct` on the NSE-fallback path. Cosmetic for display; does **not** feed entry math (entry uses LTP/spread/OI, not `ltpChgPct`). Recommend: label the field as approximate on the NSE path, or null it. *(read-only/UI fix — safe, but deferred for sign-off since it touches a shared response shape.)*

### Detectors & confidence
- `emitOptionSignals` runs detectors (`trendContinuation`, `vwapReclaim`, `volumeBreakout`, `emaPullback`, `meanReversion`); Phase-3 `scoreConfluence` (`confluenceEngine.ts`) REPLACES per-detector confidence with a confluence-adjusted score (EMA stack / VWAP / volume profile / regime / IV rank). Matches `docs/paper-trader-architecture.md`. No correctness issue found.

### Gates
- Demotion partition (HTF daily + true-1h, noise window, expiry, RS, low-winrate, vol-clamp) and post-emission ATM-OI mutation behave as documented; all P3 gates **fail-OPEN** on data failure. Hard rejections at open (FNO_LIQUIDITY, DD caps, heat cap) **fail-CLOSED** and run inside the `FOR UPDATE` account transaction. This fail-open (demotion) vs. fail-closed (hard reject) split is correct and intentional.
- **[P3] Observability:** demotion/rejection reasons are well captured in `fno_signal_reasoning`; the new `/api/fno/*` views now make them queryable in one place. No gap.

### Entry
- `openPaperTrade` gate sequence (auto-trade flag → confidence floor → market-open → consecutive-stops → daily/weekly DD → 15:25 cutoff → premium/stop validation → liquidity), transaction-wrapped with `FOR UPDATE`. Dev is read-only unless `PAPER_TRADING_ENABLED`. Sound.

### Stop / target / sizing
- Stop `max(0.45% spot, 0.6×ATR15)` with floor `max(0.30% spot, 1.0×ATR15)`; target `min(structural, max(1% spot, 1.6×ATR15))`; lots = `riskAmount / perShareLoss` with `riskPctForConfidence` budget (overridden by `PAPER_FIXED_LOTS` for STANDARD opens). Internally consistent with the safety-net table in `replit.md`. No correctness issue.

### Exit & MTM
- 30s `recordOrUpdate` → `evaluateTransition` (bar high/low wick-hit). **[P3 — by design]** when a single bar hits **both** stop and target, **stop wins** (conservative worst-case). Documented here so it is not mistaken for a bug.
- 15:20 IST `forceCloseAllOpenFnoFor1520` sweeps all OPEN FO rows; combo lane is opted out (correct). The corrective-sweep close-first ordering risk (see memory) does not apply here.

### MTM & P&L
- `realized_pnl` set at exit (`closePaperTradeForSignal`); `unrealized_pnl = (entry − last) × lots × lotSize` in `getBaselineDayStats`. Rupee-correct.
- **[P2 — by design, flagged for owner decision]** Costs (`fnoCostModel.computeFnoTradeCost`) are **shadow-only** and NOT deducted from `paper_account.balance`. Paper P&L is therefore **gross**; "realistic" net is only visible via the shadow-costs report. This is an intentional architecture decision (DD/heat are gross too), but it means headline paper P&L overstates a real-money equivalent. Making costs authoritative is a **trading-logic change** → PAUSED.

---

## D. Proposed (PAUSED — needs explicit owner sign-off)

None implemented. Listed for decision only:
1. **[P2] Net-cost authority** — fold `fnoCostModel` into realized P&L / DD / heat so paper P&L reflects a real-money equivalent. *Trading-logic + downstream-metric change; high blast radius.*
2. **[P2] NSE-fallback `ltpChgPct`** — null/label the option-leg change% on the NSE path where `prevClose` is unavailable. *Shared response-shape change.*
3. **[P3] Both-hit bar resolution** — optionally surface "ambiguous bar (SL+TGT same bar, SL applied)" as an audit reason for transparency. *Additive observability; low risk but touches exit path.*

---

## E. Test & verification summary
- `pnpm run typecheck`: **green** (all workspaces).
- api-server: **904/904** (`--pool=threads`); scanner: **554/554**.
- `/api/fno/*` × 5: **401** unauth (owner-gated, mounted).
- New unit tests: `fnoDiagnosticsFacade.test.ts` (9) covering freshness banding, spread math, funnel ordering, conversion-rate nulls, decisive win-rate, durable/ephemeral provenance split.

**Not published.** Owner to deploy when ready.
