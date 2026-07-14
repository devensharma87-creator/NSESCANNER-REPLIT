# F&O Data Accuracy + Signal Trust + Paper-Trading Truth Review

**Date:** 2026-06-05  **Mode:** READ-ONLY audit (no trading-logic / schema / scheduler / env / publish change)
**Code changed in this continuation:** **NO.** This document is evidence + analysis only. The `/api/fno/*`
diagnostics namespace audited here was delivered in the previous (already-merged) phase
(`docs/fno-audit-report-2026-06-05.md`); this review validates it, grounds it in real persisted data,
and produces the gap / data-point / detector / paper-truth tables plus read-only forward plans.

Evidence sources: route source (`artifacts/api-server/src/routes/fno.ts`), pure facade
(`fnoDiagnosticsFacade.ts`), data libs (`optionChain.ts`, `optionAnalytics.ts`, `kiteOptionChain.ts`,
`ivHistory.ts`, `giftNifty.ts`), signal libs (`optionSignals.ts`, `confluenceEngine.ts`), paper-truth UI
(`components/fno/*`, `components/reports/*`, `lib/fno/targetStatus.ts`), and **read-only SQL** against the
live dev DB (`fno_signal_reasoning`: 41,164 rows / 16 sessions 2026-05-17→2026-06-05; `paper_trade_fo`).

---

## Section 1 — Gap check vs the approved audit requirement

| # | Required item | Delivered | Endpoint / file | Data source | Durable DB? | Fabricates? | Known limitation | Fix type |
|---|---|---|---|---|---|---|---|---|
| 1 | `/api/fno/data-health` | ✅ Yes | `routes/fno.ts` | Kite session/feed, live quotes, option-chain+analytics | No (live snapshot) | No (honest `unavailable`) | No live "signal allowed?" verdict; spot provider label absent | read-only enhancement |
| 2 | `/api/fno/diagnostics/today` | ✅ Yes | `routes/fno.ts` | `fno_signal_reasoning` (IST date) + open positions | Yes | No | Demotion tags depend on logger writing them | none |
| 3 | `/api/fno/diagnostics/gate-waterfall` | ✅ Yes | `routes/fno.ts` + `fnoDiagnosticsFacade.buildGateWaterfall` | `fno_signal_reasoning` | Yes | No (null-guarded rates) | Funnel = decision counts, not per-candidate trace | none |
| 4 | `/api/fno/diagnostics/no-trade-reasons` | ✅ Yes | `routes/fno.ts` + `buildNoTradeReasons` | durable reasoning + ephemeral missed ring (provenance-tagged) | Partly | No | Ring is process-local, resets on restart (labelled) | none |
| 5 | `/api/fno/diagnostics/setup-performance` | ✅ Yes | `routes/fno.ts` + `buildSetupPerformance` | `fno_signal_reasoning` | Yes | No | No realized P&L here (points to `/paper/analytics/fo/shadow-costs`) | by design |
| 6 | End-to-end data pipeline audit | ✅ Yes | this doc §3, §8 + `docs/fno-audit-report-2026-06-05.md` | code + DB | — | No | Several data points genuinely unimplemented (§8) | read-only |
| 7 | Signal detector audit | ✅ Yes | this doc §9 | `optionSignals.ts`, `confluenceEngine.ts` | — | No | — | none |
| 8 | Entry/stop/target/exit audit | ✅ Yes | this doc §6 | code + `fno_signal_reasoning` cols | Yes | No | Premium-target-touch ≠ exit (known) | trading-impacting (paused) |
| 9 | Paper-trading report truth audit | ✅ Yes | this doc §7 | scanner UI + `fnoShadowCosts.ts` | Yes | No | Realized/DD/heat are GROSS; net is shadow-only | trading-impacting (paused) |
| 10 | Swing-trading audit readiness | ✅ Plan | this doc §10 | — | — | — | plan only, no audit run yet | read-only (future) |
| 11 | Market info-hub audit readiness | ✅ Plan | this doc §11 | — | — | — | plan only | read-only (future) |

**Gap verdict:** items 1–9 are delivered and grounded; 10–11 are read-only plans (as scoped). The only
*missing fields* worth surfacing are read-only enhancements to `data-health` (§3 P0/P1 list) — none are bugs
blocking this report, so per the rules **no code was changed**.

---

## Section 2 — Endpoint validation & sample shapes

**Auth gating (runtime, unauthenticated):** all five return `401 {"error":"unauthorized","code":"AUTH_REQUIRED"}`
when no session and public-mode off; `403 OWNER_ONLY` for a non-owner session; in public-access mode GET is
allowed read-only (via `requireOwner`, `userAuth.ts`). Verified 401 on all five in the previous phase.

**Why no live authenticated JSON dump here:** producing live owner JSON requires POSTing the
`APP_ACCESS_PASSWORD` secret to mint a signed `scanner_session` cookie. To honour "no env/secret handling"
the shapes below are derived **directly from the authored route source** (accurate by construction). Runtime
safety is assured structurally: every handler body is wrapped in `try/catch → next(err)`; `data-health`
additionally isolates each index and the analytics step in nested `try/catch`, and option-chain/quote fetches
use `.catch(() => null)`. None of the five use Zod (raw `res.json`, mirroring `/paper/diagnostics/*`) so
**ZodError is not reachable**. Honest-null behaviour is covered by `fnoDiagnosticsFacade.test.ts` (9 tests).
`today` uses `istDateOf()` (IST market date), **not** server UTC — confirmed in `routes/fno.ts`.

**`GET /api/fno/data-health`** (optional `?index=NIFTY`)
```jsonc
{
  "generatedAt": "2026-06-05T09:42:11.004Z",
  "environment": "DEV — paper auto-trading READ-ONLY",
  "universe": ["NIFTY", "BANKNIFTY", "SENSEX"],
  "kite": {
    "credsConfigured": true,
    "session": { "present": true, "user": "<redacted>", "loginTime": "...", "expiresAt": "...", "minsToExpiry": 287 },
    "feed": { /* feedStatus(): connected/subscriptions/lastTickAt etc. */ }
  },
  "perIndex": [{
    "indexSymbol": "NIFTY", "display": "NIFTY 50",
    "spot":  { "status": "ok", "price": 24812.3, "asOf": "2026-06-05T09:42:07.000Z", "ageSec": 4 },
    "chain": { "status": "ok", "source": "kite", "generatedAt": "...", "ageSec": 12,
               "expiry": "2026-06-11", "atmStrike": 24800, "rowCount": 41,
               "atmLeg": { "ce": {"oi":1.2e6,"ltp":98.4,"spreadPct":0.41},
                           "pe": {"oi":1.4e6,"ltp":104.2,"spreadPct":0.38} },
               "analytics": { "pcrOi":1.07, "pcrVolume":0.92, "maxPain":24800, "atmIv":12.7, "bias":"NEUTRAL", "confidenceScore":58 } }
  }],
  "reasoningLogger": { /* getReasoningLoggerHealth(): writes/failures/lastWriteAt */ },
  "note": "Read-only F&O data-source health. ATM liquidity is informational; binding FNO_LIQUIDITY gate enforced at trade time."
}
```
Honest states: `spot:{status:"unavailable",reason:"no live index quote"}`; `chain:{status:"unavailable",reason:"..."}`;
`analytics:null` when `computeAnalytics` throws. Freshness bands: spot warn>15s/fail>60s; chain warn>60s/fail>5min.

**`GET /api/fno/diagnostics/today`** → `{ generatedAt, signalDate(IST), environment, decisions{byDecision},
funnel, conversion, demotionTags, noTradeReasons, openPositions{count,indices[]}, reasoningLogger }`.

**`GET /api/fno/diagnostics/gate-waterfall`** (filters: index/setup/direction/tier/decision/reason/regime/from/to/latestN)
→ `{ filters, waterfall:{ funnel[], conversion:{openRate|null, decisiveWinRate|null}, byReason[], byTier[] } }`.

**`GET /api/fno/diagnostics/no-trade-reasons`** → `{ filters, noTradeReasons:{ durable[]{reason,count}, ephemeral[]{...,source:"missed-ring"} } }`.

**`GET /api/fno/diagnostics/setup-performance`** → `{ filters, setupPerformance:[{ setupKey, emitted, opened, target1, target2,
stopped, expired, decisiveWinRate|null, avgConfidence, avgConfluence }] }`.

---

## Section 3 — F&O data-health field audit (NIFTY / BANKNIFTY / SENSEX)

| Field | Exposed by data-health? | Note | Priority if missing |
|---|---|---|---|
| spot source | ⚠️ Partial | price+freshness shown; **provider label (Kite/NSE/Yahoo) not** surfaced for spot | **P1** |
| spot timestamp | ✅ `spot.asOf` | | — |
| spot freshness sec | ✅ `spot.ageSec` + status band | | — |
| WebSocket status | ✅ `kite.feed` | | — |
| Kite session status | ✅ `kite.session` (+minsToExpiry) | | — |
| index quote status | ✅ `spot.status` | ok/warn/fail/unavailable | — |
| option-chain source | ✅ `chain.source` | kite/nse/yahoo | — |
| expiry selected | ✅ `chain.expiry` | | — |
| ATM strike | ✅ `chain.atmStrike` | | — |
| strikes loaded | ✅ `chain.rowCount` | | — |
| CE / PE availability | ⚠️ Partial | ATM leg only (`atmLeg.ce/pe`), not full-ladder coverage % | P2 |
| bid/ask availability | ⚠️ Partial | only `spreadPct` derived at ATM; raw bid/ask not surfaced | P1 |
| spread status | ⚠️ Partial | `spreadPct` value shown, no ok/warn band on it | P1 |
| OI availability | ✅ ATM `oi` (+PCR via analytics) | | — |
| IV availability | ✅ `analytics.atmIv` | | — |
| PCR availability | ✅ `pcrOi`,`pcrVolume` | | — |
| max-pain availability | ✅ `analytics.maxPain` | | — |
| expected-move availability | ❌ Not implemented (§8) | | P1 |
| data quality status | ⚠️ Partial | per-section status only; no single rolled-up per-index verdict | P1 |
| **whether F&O signal is allowed** | ❌ **Not surfaced** | data-health shows data health, not a live "signal allowed" verdict | **P0** |
| **blocking reason if not allowed** | ❌ **Not surfaced** | liquidity gate referenced in `note` but not evaluated live | **P0** |

**P0 (signal-trust) read-only enhancement candidates** (NOT implemented — paused for sign-off): add per-index
`signalAllowed:boolean` + `blockingReason` by *read-only* evaluation of the existing `FNO_LIQUIDITY` constants
against the ATM leg already fetched here. This reads gate constants; it changes no trading behaviour. **P1:** spot
provider label, raw ATM bid/ask, spread band, rolled-up data-quality verdict, expected-move. **P2:** full-ladder CE/PE coverage %.

---

## Section 4 — Gate-waterfall audit (REAL data, 16 sessions)

Top-of-funnel (all 41,164 decisions, 2026-05-17→06-05):

| Decision | Count | Share |
|---|---|---|
| PRE_EMISSION_REJECTED | 34,437 | **83.7%** |
| EMITTED | 6,718 | 16.3% |
| MISSED_WINDOW | 9 | 0.02% |

Where candidates die (rejection `reason_code`):

| Gate / Reason | Count | % of rejections | Category | Impact | Fix candidate (paused) |
|---|---|---|---|---|---|
| CONDITIONS_NOT_MET | 20,162 | 58.5% | **Data / setup** | No genuine setup present — expected | none (healthy) |
| LATE_SESSION_ENTRY | 6,472 | 18.8% | **Time gate** | Time-of-day cutoff blocks late entries | review cutoff (trading-impacting) |
| OTHER | 3,454 | 10.0% | Mixed | catch-all — worth sub-classifying | read-only: finer reason codes |
| HC_FLOOR | 2,049 | 5.9% | Confidence floor | adj. confidence <65 → demote | review floor (trading-impacting) |
| VWAP_RECLAIM_LATE | 1,620 | 4.7% | **Time gate** | VR after 13:30 IST | review cutoff (trading-impacting) |
| POST_CLAMP_RR | 541 | 1.6% | Risk-shape | RR<1.4 after ATR clamp | review (trading-impacting) |
| OI_VETO | 43 | 0.12% | Data/OI | tiny — not a bottleneck | none |
| OI_CONFLICT | 37 | 0.11% | Data/OI | tiny | none |
| BIAS_FLIP | 32 | 0.09% | Cooldown | tiny | none |
| NO_BARS | 27 | 0.08% | Data | data outage | none |

**Answers to the audit questions:**
- *Where do candidates die?* Overwhelmingly at **CONDITIONS_NOT_MET** (genuine no-setup) — this is healthy, not a defect.
- *Which gate blocks most?* CONDITIONS_NOT_MET; the largest *tunable* block is **time-of-day** (LATE_SESSION_ENTRY + VWAP_RECLAIM_LATE = 8,092, **23.5% of rejections**).
- *Detector producing most candidates?* HC detectors are each evaluated ~6,200×; **BASELINE** dominates *emission* (6,377).
- *Detector producing most emitted?* BASELINE 6,377 → VWAP_RECLAIM 145 → EMA_PULLBACK 135 → TREND_CONTINUATION 61. **VOLUME_BREAKOUT 0 and MEAN_REVERSION 0 emitted in 16 sessions** (see §9 — dormant detectors).
- *Risk gates vs data gates?* **Data/condition + time gates dominate; risk caps are NOT the bottleneck** (POST_CLAMP_RR only 1.6%, OI vetoes <0.3%, no DD/heat cap rejections in top reasons).
- *Liquidity/spread/OI too restrictive?* No evidence here — OI vetoes are negligible.
- *Session/time filters causing drought?* **Yes, materially (23.5%)** — the single most actionable *tunable* finding, but **DO NOT tune without sign-off**.

> Per the rules: gates were **not** tuned. These are observations only.

---

## Section 5 — Setup-performance audit (REAL data)

`fno_signal_reasoning` emission by setup, and `paper_trade_fo` outcomes:

| Setup | Rejected | Emitted | Paper trades | Closed | Outcomes | Gross P&L | Decisive WR | Sample? | Action |
|---|---|---|---|---|---|---|---|---|---|
| BASELINE | — | 6,377 | 7 | 7 | T1×1, STOP×2, EXPIRED×4 | **+₹6,508.30** | 1/3 = 33% | ❌ n=7 | **needs more sample** |
| VWAP_RECLAIM | 6,205 | 145 | 0 | 0 | — | — | — | ❌ | needs sample |
| EMA_PULLBACK | 6,097 | 135 | 0 | 0 | — | — | — | ❌ | needs sample |
| TREND_CONTINUATION | 6,218 | 61 | 0 | 0 | — | — | — | ❌ | needs sample |
| VOLUME_BREAKOUT | 6,218 | **0** | 0 | 0 | — | — | — | ❌ | **investigate (never emits)** |
| MEAN_REVERSION | 6,218 | **0** | 0 | 0 | — | — | — | ❌ | **investigate (never emits)** |

`paper_trade_fo` closed-trade detail: EXPIRED×4 (+₹6,174.60), STOPPED×2 (−₹3,085.60), TARGET1_HIT×1 (+₹3,419.30).

**Findings (no action taken):**
- **Every opened F&O paper trade is BASELINE-tier.** No high-conviction setup has ever opened a paper trade in this data.
  Caveat: dev/workspace runs the auto-trader **read-only** (`PAPER_TRADING_ENABLED` off), so these rows reflect when
  trading was enabled (prod/earlier); treat n=7 as **far too small** to draw any performance conclusion.
- **Net (post-cost) P&L is not in this view** — `+₹6,508.30` is **GROSS**. The shadow-cost net lives in
  `/paper/analytics/fo/shadow-costs` (`fnoShadowCosts.ts`). Do not read this as a real-money-equivalent figure.
- **Do not tune or disable any setup from this sample** — sample size is insufficient and would overfit.

---

## Section 6 — Entry / stop / target / exit audit

| Stage | Current logic | Source | DB field | UI display | Issue | Fix candidate |
|---|---|---|---|---|---|---|
| Entry trigger | 15m close breaks intraday swing/VWAP/VAH-VAL per detector; `applyTriggerRealism` (≤0.5% of spot) | `optionSignals.ts` | `spot_entry` | FoWhyThisTrade | — | none |
| Entry premium source | option LTP at selected ATM strike (Kite→NSE) | `optionChain.ts` | `entry_premium`, `option_entry` | open table | — | none |
| Underlying trigger level | spot-based level | `optionSignals.ts` | `spot_entry` | — | — | none |
| Confirmation candle | 15m close beyond level (not wick) | `optionSignals.ts` | — | — | — | none |
| **Premium vs spot basis** | plan levels computed on **spot**; premium levels are derived/reported | `optionSignals.ts`,`targetStatus.ts` | `option_target1/2`,`spot_target1/2` | FoWhyThisTrade | **divergence possible (see below)** | trading-impacting (paused) |
| Stop basis | ATR-clamped spot stop; sanity 1%–8% (equity) / vol-clamp ratio (F&O) | `optionSignals.ts`,`paperAccount.ts` | `spot_stop`,`option_stop` | open table | — | none |
| Target basis | spot T1/T2 from RR after clamp (min RR 1.4) | `optionSignals.ts` | `spot_target1/2` | open table | — | none |
| T1 behaviour | **spot-lifecycle driven** | `fnoSpotLifecycle.ts` | exit_reason `TARGET1_HIT` | closed review | — | none |
| T2 behaviour | spot-lifecycle driven | `fnoSpotLifecycle.ts` | exit_reason `TARGET2_HIT` | closed review | — | none |
| Force-exit | 15:20 IST force-close all open FNO | `paperAccount.ts` | exit_reason `TIME_EXIT_1520` | closed review | — | none |
| Manual-exit | owner-initiated close | routes | exit_reason | — | not gated by env | none |
| MTM basis | live option LTP × lots × lotSize | mark-to-market | `unrealized` | "Unrealised MTM" | — | none |
| `last_evaluated_at` freshness | updated on each MTM tick | schema | — | — | surface staleness | read-only |
| **Premium target touch vs spot target trigger** | premium T1/T2 touch is **informational/reporting only**; exit is **spot-lifecycle driven** | `targetStatus.ts` | `target1Premium`,`target2Premium`,`maxRunup` | FoWhyThisTrade | **KNOWN: premium T1/T2 can be touched while spot target not reached; premium touch does NOT trigger exit** | trading-impacting (paused) |

**Known issue (confirmed, surfaced as required):** premium T1/T2 can be *touched* (option ran up) while the
**spot** target is not reached; the current exit is **spot-lifecycle driven**, so the premium touch is recorded
for transparency (`deriveDivergence` / `derivePremiumTargetStatus`) but is **not an exit trigger**. Changing this
is a trading-logic change → **paused for explicit sign-off.**

---

## Section 7 — Paper-trading truth audit

| Item | Status in UI | Source |
|---|---|---|
| Gross P&L | shown as "Realised P&L" | DB `realized_pnl` (= (exit−entry)×lots×lotSize, **gross**) |
| Shadow-cost / net estimate | computed `grossPnl/totalCost/netPnl` + `flippedToLoss` | `fnoShadowCosts.ts`, `/paper/analytics/fo/shadow-costs` |
| Net label in summary tiles | ⚠️ tiles read "Realised P&L"; net surfaced separately (charges/netPnl in report rows) | `paper-reports.tsx`, `ReportsOverviewCards` |
| Realized P&L basis | **GROSS** (costs are shadow/reporting only) | `paperAccount.ts` |
| Unrealized P&L basis | live MTM, "Unrealised MTM / Not yet booked" | `FoCockpitSummaryCards` |
| MFE / MAE | `maxRunup` / `maxDrawdown`; `ReportsMfeMaeReview`; cockpit shows "—" with "not in closed payload" when absent | `targetStatus.ts`, reports |
| Giveback | computed in `derivePremiumTargetStatus`, shown in FoWhyThisTrade | `targetStatus.ts` |
| Target-status reporting | `deriveFoTargetStatus` / `FoTargetStatusView` | `targetStatus.ts` |
| Closed-trade explanation | `buildClosedExplanation`, distinguishes `TIME_EXIT_1520` vs `STOPPED` vs target | `FoWhyThisTrade.tsx` |
| Premium-vs-spot divergence | `deriveDivergence`, shown as informational | `targetStatus.ts` |
| Daily / monthly / yearly | `FOReport` period toggles | `paper-reports.tsx` |
| Paper account card | `EqAccountCard`, `FoCockpitSummaryCards` | scanner |
| Heat / DD display | `FoCockpitSummaryCards` + `FoCockpitSafetyBanner` (**GROSS**) | scanner |

**Truthfulness verdict:**
- The UI is honest about **paper / review-only** nature (`ReportsSafetyBanner`: "Paper trading analytics only",
  "Reports are review/support tools only") and about **unavailable** metrics ("—", never estimated).
- **Known weakness to surface (not fix here):** **realized P&L, DD caps and heat caps are GROSS** — shadow costs
  are reporting-only and are **not** folded into the booked figure or the risk caps. The report-row pairing
  (`realizedPnl` + `charges` + `netPnl`) exposes net where present, but the **headline "Realised P&L" tiles and the
  heat/DD safety banner do not clearly state they are pre-cost**. A user could mistake the gross tile for a
  net/real-money figure. Recommended **read-only** clarification: label the gross tiles "(gross, pre-cost)" and
  add a one-line note that DD/heat caps operate on gross. (STT/shadow constants themselves were already fixed.)
- Making realized/DD/heat **net** is a **trading-logic / risk change → paused for sign-off** (see memory:
  `fno-cost-model-scope`).

---

## Section 8 — F&O data-point table

| Data point | Implemented | Source | File / fn | Logic | Freshness | Issue / fix |
|---|---|---|---|---|---|---|
| spot price | ✅ | Kite→NSE→Yahoo | `optionChain.getSpotForUnderlying` | quote LTP | 15s Kite / 30s NSE | — |
| futures price | ⚠️ Partial | TradingView | `giftNifty.ts` | `NSEIX:NIFTY1!` only | 30s TTL | NIFTY-only; not per-index |
| futures premium/discount (basis) | ❌ | — | — | — | — | not computed |
| option chain | ✅ | Kite→NSE | `fetchOptionChain` | orchestrated | 15s/30s | — |
| expiry selected | ✅ | Kite/NSE | `fetchOptionChain` | nearest/requested ISO | — | — |
| weekly/monthly expiry | ✅ | Kite/NSE | `fetchOptionChain` (expiries[]) | list exposed | — | — |
| ATM strike | ✅ | derived | `fetchOptionChain` | round(spot/step)×step | per fetch | — |
| ITM/ATM/OTM | ✅ | derived | `classifyMoneyness` | step/2 band | per row | — |
| CE/PE LTP | ✅ | Kite/NSE | `fetchKiteOptionChain` | last_price | 15s/30s | — |
| CE/PE bid/ask | ✅ | Kite/NSE | `fetchKiteOptionChain` | L1 depth / NSE | 15s/30s | not surfaced in data-health raw |
| CE/PE volume | ✅ | Kite/NSE | `fetchKiteOptionChain` | volume | 15s/30s | — |
| CE/PE OI | ✅ | Kite/NSE | `fetchKiteOptionChain` | oi | 15s/30s | — |
| CE/PE change-in-OI | ✅ | Kite/NSE | `fetchKiteOptionChain` | Kite inferred via oi_day_high/low; NSE direct | 15s/30s | Kite ΔOI is inferred, not exact |
| CE/PE IV | ✅ | derived/NSE | `kiteOptionChain.impliedVolatility` | BS Newton-Raphson / NSE direct | 15s/30s | null if σ>5 |
| CE/PE spread | ✅ | derived | `fnoDiagnosticsFacade.atmSpreadPct` | (ask−bid)/mid×100 | on access | — |
| lot size | ✅ | Kite/static | `optionChain.LOT_SIZES` | instrument dump + fallback | daily | — |
| tick size | ❌ | — | — | in dump, not mapped | — | not exposed |
| instrument token | ❌ | — | — | internal only | — | not in OcRow |
| contract symbol mapping | ✅ | Kite | `fetchKiteOptionChain` | tradingsymbol | daily | — |
| NFO/BFO handling | ✅ | Kite | `fetchKiteOptionChain` | per-instrument exchange | — | — |
| PCR by OI | ✅ | derived | `computeAnalytics` | ΣputOI/ΣcallOI | per fetch | — |
| PCR by volume | ✅ | derived | `computeAnalytics` | Σputvol/Σcallvol | per fetch | — |
| PCR by change-in-OI | ❌ | — | — | totals exist, ratio not exposed | — | low-risk read-only add |
| max pain | ✅ | derived | `computeMaxPainStrike` | min buyer loss | per fetch | — |
| IV skew | ❌ | — | — | — | — | not implemented |
| IV rank / percentile | ✅ | DB+derived | `ivHistory.computeIvMetrics` | 252-day rank/percentile | daily | — |
| ATM straddle | ❌ | — | — | ATM CE+PE LTP available, not summed | — | low-risk read-only add |
| expected move | ❌ | — | — | — | — | not implemented |
| India VIX | ⚠️ Partial | Yahoo `^INDIAVIX` | `kiteIndexQuotes`/`yahoo` | fetched, **not in OptionAnalytics** | — | wire into analytics (read-only) |
| realized volatility | ❌ | — | — | — | — | not implemented |
| implied volatility | ✅ | derived/NSE | `kiteOptionChain` | per-strike | 15s/30s | — |
| OI buildup | ✅ | derived | `classifyOiBuildup` | price×OI matrix | per fetch | — |
| long buildup | ✅ | derived | `classifyOiBuildup` | price↑ OI↑ | per fetch | — |
| short buildup | ✅ | derived | `classifyOiBuildup` | price↓ OI↑ | per fetch | — |
| short covering | ✅ | derived | `classifyOiBuildup` | price↑ OI↓ | per fetch | — |
| long unwinding | ✅ | derived | `classifyOiBuildup` | price↓ OI↓ | per fetch | — |
| support/resistance from OI | ✅ | derived | `computeAnalytics` | top-5 OI strikes | per fetch | — |
| option-chain staleness | ✅ | derived | `classifyFreshness` | generatedAt vs now | on access | — |
| missing-strike detection | ❌ | — | — | — | — | not implemented |
| abnormal-IV detection | ⚠️ Partial | derived | `impliedVolatility` | null if σ>5 (500%) | — | no explicit flag/band |
| abnormal-spread detection | ⚠️ Partial | derived | `atmSpreadPct` | value only, severity in UI | — | no fixed band |

**Genuinely unavailable (do NOT fabricate; mark unavailable in any UI):** futures basis, PCR-by-ΔOI ratio,
IV skew, ATM straddle price, expected move, realized volatility, tick size, instrument token, missing-strike
detection. India VIX & per-index futures are partial.

---

## Section 9 — Signal detector audit

| Detector | Bullish trigger | Bearish trigger | Raw confidence | Should NOT fire | Missing-data | Overlap | Recommendation |
|---|---|---|---|---|---|---|---|
| TREND_CONTINUATION | 15m close > intraday swing high | < swing low | base45 +15 RSI band +8 POC +8 vol | <09:30 / >14:30 IST; EXTREME vol haircut | skip if no full indicators | dir-overlaps EP | keep (emits 61) |
| VWAP_RECLAIM | close > VWAP after 3–4 below | close < VWAP after above | base60 +12 EMA +8 vol | >13:30 IST | skip if vwapSeries null | overlaps TC dir | keep (emits 145) |
| VOLUME_BREAKOUT | close > VAH | close < VAL | base65 +5 RSI | — | skip if vp/lastVol null | overlaps TC | **investigate: 0 emits/16 sessions** |
| EMA_PULLBACK | close > last high (stack up) | < last low (stack down) | base65 + weighted drivers | stack not clean | skip if stack unaligned | overlaps TC | keep (emits 135) |
| MEAN_REVERSION | RSI<25 & spot<VWAP−2·ATR | RSI>75 & spot>VWAP+2·ATR | base60 +5 toward-VA | criteria unmet | skip | counter-trend (distinct) | **investigate: 0 emits/16 sessions** |
| BASELINE | close > swing high | < swing low | 35 + 5×(indicators agreeing) (35–55) | — | **fail-open (always emits)** | floor for all | keep (only setup that trades) |

**Confluence engine** (`scoreConfluence`): `adjusted = raw + volHaircut(−8 EXTREME/−4 HIGH) + Σ factors`, factors
EMA_STACK(+5/−8), VWAP(+3/−6), VOLUME_PROFILE(+3/−3), REGIME(+5/−10), IV_RANK(±2); `<65 → demote to BASELINE`.
Pass-3 further demotes on HTF1h conflict, RS conflict, 30-day low win-rate. Legacy per-detector confidence
preserved in `optionSignals.legacyEmit.bak.ts` (not active).

**Key finding:** VOLUME_BREAKOUT and MEAN_REVERSION are **effectively dormant** (0 emissions in 16 sessions) — either
their conditions are too strict or their required data (`vp`/`lastVol`, RSI extremes) is rarely present at decision
time. This warrants a **read-only investigation** (log why they skip) before any tuning — **no detector logic changed.**

---

## Section 10 — Swing-trading audit plan (read-only, NOT executed)

Scope to verify (no scoring change): scanner universe (NIFTY 500), data source (Kite→Yahoo, `swingScannerData.ts`),
freshness (deep scan once/day after 15:35 IST + 15m LTP refresh, `swingScannerStore.ts`), EMA/RSI/VWAP/ADX/ATR
math (`swingScanner.ts`), sector & relative strength, entry quality + late-entry-at-resistance
(`computeEntrySafety` in `lib/scoring.ts`), support/demand zones, stop/target/R:R logic, paper-entry gates
(STRONG_BUY requirement + equity DD/heat), trailing/time stop, paper P&L (gross vs net), reports, UI explanation.
**Files:** `swingScanner.ts`, `swingScannerData.ts`, `swingScannerStore.ts`, `lib/scoring.ts`,
`equitySizingHelper.ts`, `paperAccount.ts`, scanner `stocks-to-watch`/`stock-detail` pages.
**Risks:** any change touches scanner scoring / equity execution → must stay read-only; large universe = rate-limit
care on live fetch. **Output of the future run:** evidence tables mirroring §6–§8 for the equity swing lane.

---

## Section 11 — Market information-hub audit plan (read-only, NOT executed)

For each surface verify: source, freshness, fallback, delayed-data label, stale-data warning, empty-state honesty,
formula explanation, UI explanation. Surfaces: indices board, pre/post-market, market breadth, sector heatmap,
FII/DII, participant OI, India VIX, global cues, GIFT Nifty (`giftNifty.ts`), stocks-to-watch, OI Lab,
option chain, strategies, charting, portfolio, paper reports, infra-health (`/infra-health` already exists),
data-quality panels. **Approach:** extend the existing `/infra-health` model — one read-only roll-up per surface
with honest severity (reuse `infraHealth.ts` helpers). **No UI redesign.**

---

## Section 12 — Diagnostics UI plan (read-only, NOT built)

Minimal owner-only **F&O Diagnostics** page consuming only the five `/api/fno/*` endpoints (+ existing
`/paper/analytics/fo/shadow-costs` for net): Data-Health card, Today-Summary card, Gate-Waterfall table,
No-Trade-Reasons table, Setup-Performance table, freshness warnings, Kite status, option-chain status,
paper-truth notes (gross-vs-net caveat).
- **Files likely to change:** new `pages/fno-diagnostics.tsx` + a nav entry (string allow-list, mirroring the
  Portfolio Analyser pattern — no DB migration); small `lib/fno/diagnostics-fetch.ts` for typed fetch.
- **API hooks:** plain `fetch` (these endpoints are **not** OpenAPI-typed, like `/paper/diagnostics/*`) → **no
  codegen required**.
- **Risk:** low (read-only, owner-gated, no backend change). **Estimated work:** ~½ day. **Build only if approved.**

---

## Section 13 — Validation results

`pnpm run typecheck` · `pnpm --filter @workspace/api-server run test` (`--pool=threads`) ·
`pnpm --filter @workspace/scanner run test` — see run at the end of this continuation. No OpenAPI change →
no codegen. **No DB migration run.**

---

## Section 14 — Final report (A–K)

- **A. Files changed:** only this report doc (`docs/fno-data-accuracy-signal-trust-review-2026-06-05.md`).
- **B. Any code changed?** **NO.** (No blocking diagnostic bug was found; gap items are read-only enhancements, paused.)
- **C. Endpoint validation:** five endpoints structurally safe (try/catch + per-index isolation + `.catch`), no Zod (no ZodError), honest nulls (9 facade tests); `today` uses IST date. Sample shapes in §2.
- **D. Auth-gating:** all owner-only via `requireOwner` → 401 unauth / 403 non-owner / GET allowed in public mode.
- **E. Data-health findings:** strong on session/feed/freshness/source; **P0 gap = no live "signal allowed / blocking reason" verdict**; P1 = spot provider label, raw bid/ask, spread band, expected move.
- **F. Today diagnostics:** funnel + demotions + no-trade + open positions in one IST-correct call.
- **G. Gate-waterfall:** 83.7% rejected; dominated by CONDITIONS_NOT_MET (healthy) then **time-of-day gates (23.5%, the top tunable lever)**; risk caps are NOT the bottleneck.
- **H. No-trade reasons:** durable (DB) vs ephemeral (ring) separated with provenance; top durable reason CONDITIONS_NOT_MET.
- **I. Setup-performance:** **all 7 opened trades are BASELINE**; HC setups have ~0 trades; **VOLUME_BREAKOUT & MEAN_REVERSION never emit (16 sessions)** — investigate read-only; samples far too small to tune; P&L shown is GROSS.
- **J. Entry/stop/target/exit:** spot-lifecycle driven; **premium T1/T2 touch is informational, NOT an exit trigger** (known) — change is paused.
- **K. Paper-trading truth:** UI honest about paper/review nature & unavailable data, but **realized P&L / DD / heat are GROSS and the headline tiles don't say "pre-cost"** — recommend a read-only label clarification; making them net is paused for sign-off.

**Paused for explicit owner sign-off (all trading-impacting):** (1) net-of-cost realized P&L / DD / heat;
(2) premium-target exit semantics; (3) time-of-day cutoff review; (4) HC_FLOOR / RR floor review;
(5) reviving VOLUME_BREAKOUT / MEAN_REVERSION. Read-only, low-risk follow-ups (no sign-off needed beyond a
"go"): data-health `signalAllowed`/`blockingReason`, spot provider label, ATM straddle / expected-move / PCR-by-ΔOI
display, India-VIX wiring into analytics, and the F&O Diagnostics UI page (§12).
