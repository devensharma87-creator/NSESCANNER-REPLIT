# F&O / Option-Chain Signal-Safety Audit

**Scope:** Audit and migrate F&O / option-chain consumers onto the trusted central
market-data layer, and guarantee that no official signal or paper-trade decision is
made from stale, synthetic, missing, Yahoo, or otherwise untrusted option data.

**Status:** Phase 0 — AUDIT (this document). No live trade-path behavior changed yet.
Implementation phases are sequenced at the end.

**Date:** 2026-06-10

---

## Data policy (target state)

- **Kite is primary** for NFO quotes, option prices, futures, OI, and instruments.
- **INDstocks** may act as `secondary_validation`/failover **only** through the central
  provider layer (never powers a trade/signal/valuation; guard rejects its tier).
- **Yahoo must not power** F&O signals, option-chain premiums/OI, paper trades, or risk
  calculations. Yahoo is acceptable only for non-F&O analytics (index spot for *display*
  analytics), and even there it must be labelled.
- **Synthetic/proxy option prices must never be treated as real.**
- If option data is stale / missing / conflicting → the signal must be **blocked or
  demoted with an exact reason**. No silent fallback. No fake option-chain rows. No stale
  OI/premium shown as live.

---

## What is ALREADY safe (verified in code)

These protections already exist and satisfy parts of the acceptance criteria. The
migration must **preserve** them.

1. **Paper-trade open path hard-blocks non-Kite bar quality.**
   `tryOpenPaperTrades` (`paperTradingFO.ts:2533`) calls `isActionableForFno(quality)`
   (`tradingConfig.ts:43`). Only `LIVE_KITE_FULL` / `LIVE_KITE_PARTIAL` are actionable;
   `DELAYED_YAHOO` and `STALE` are rejected with explicit skip reasons
   (`DATA_QUALITY_DELAYED` / `DATA_QUALITY_STALE`) and recorded as missed signals. The
   former `PAPER_TRADE_ALLOW_YAHOO` escape hatch was permanently removed (2026-05-06).

2. **Tier gating blocks non-STANDARD opens.** Under `FNO_SIGNAL_HYGIENE_V2`,
   `isAutoTradeableSizingTier` (`optionSignalVetoes.ts:103`) blocks anything that is not a
   tradeable STANDARD tier; vetoed setups demote to `INFO_ONLY` and cannot open trades.

3. **Liquidity gates** on the option leg at open: `MIN_OPTION_LTP=5.0`,
   `MAX_BID_ASK_SPREAD_PCT=0.15`, `OI≥50k` (`paperTradingFO.ts` liquidity block).

4. **Drawdown / consecutive-stop / time-of-day caps** all active (`paperAccount.ts`).

5. **Trusted option-chain facade exists** (`marketData/optionChainProvider.ts`):
   `getOptionChain()` is Kite-only, rejects expired expiry / empty / non-positive spot,
   flags missing OI, and returns an explicit `unavailable` `DataMeta` instead of falling
   back to NSE/Yahoo. **It is currently wired to nothing.**

6. **Write-side provenance** on the candle warehouse prevents a lower-trust row from
   overwriting a Kite row (`candleWarehouseIngestor.ts`).

---

## Module-by-module audit

Legend: **CF** = uses central option-chain facade; **DP** = direct provider call;
**SYN** = synthetic/proxy data risk; **STALE** = stale-data risk; **SIG** = data feeds
an official signal or paper-trade decision.

### 1. Option Chain page
- **Frontend:** `artifacts/scanner/src/pages/option-chain.tsx`
- **Endpoint:** `GET /api/options/chain/:underlying`, `GET /api/options/analytics/:underlying`
- **Backend:** `routes/optionChain.ts` → `fetchOptionChain` (`lib/optionChain.ts`)
- **Current source:** Kite first → **NSE-direct fallback** → **Yahoo for index spot**
  (`getSpotForUnderlying`)
- **CF:** NO &nbsp; **DP:** YES (legacy `fetchOptionChain`) &nbsp; **SYN:** NO (premiums/OI
  return null rather than synthesize) &nbsp; **STALE:** YES (no freshness envelope on the
  served payload; UI infers source heuristically) &nbsp; **SIG:** display only
- **Fix applied:** _pending Phase 1_ — serve through facade + provenance envelope.
- **Remaining limitation:** NSE is a *real* (non-synthetic) source; decision needed on
  whether to keep it as a labelled fallback or restrict the page to Kite-only.

### 2. F&O Official setups (signal engine)
- **Frontend:** `pages/options.tsx` (`SetupCard`), `pages/fno-diagnostics.tsx`
- **Endpoint:** `GET /api/options/signals`, `/signal-history`, `/signal-report`,
  `/api/fno/*`
- **Backend:** `lib/optionSignals.ts` (emission) → `scanner.ts` handlers
- **Current source:** Spot/LTP via `getKiteIndexQuotes` / `fetchKiteIntraday`; **option
  premium via legacy `fetchOptionChain`** (`optionSignals.ts:1858, 2247`) — i.e. the same
  NSE/Yahoo-spot fallback chain.
- **CF:** NO &nbsp; **DP:** YES &nbsp; **SYN:** NO &nbsp; **STALE:** PARTIAL — emission
  stamps `dataQuality` from the **intraday BAR** source only (`resolveDataQuality(intraSrc)`,
  `optionSignals.ts:2233`), **not** from the option-chain/premium source. **SIG:** YES.
- **GAP:** A signal can carry `LIVE_KITE_*` (because its bars are Kite) while its option
  **premium/OI** came from the NSE fallback chain. There is no provenance check that the
  *premium itself* is Kite-sourced.
- **Fix applied:** _pending Phase 2_ — stamp chain provenance onto the signal and gate on
  it.

### 3. F&O Legacy display
- **Backend:** `optionSignals.legacyEmit.bak.ts` (per-detector confidence, superseded by
  Phase-3 confluence). **Frontend:** legacy `/indices` route (`pages/indices.tsx`).
- **CF/DP/SYN/STALE/SIG:** Not on the live emission path (confluence engine replaces it).
  No action required beyond confirming it is not re-enabled.

### 4. Paper-trading open path
- **Backend:** `paperTradingFO.ts` — `tryOpenPaperTrades:2506` → `openPaperTrade:290`
- **Current source:** consumes the emitted signal's snapped `optionEntry`; re-validates
  liquidity from a fresh chain at open.
- **CF:** NO &nbsp; **DP:** via signal &nbsp; **SYN:** NO &nbsp; **STALE:** blocked
  (`isActionableForFno`) &nbsp; **SIG:** YES.
- **GAP:** Inherits the Phase-2 premium-provenance gap (bar quality is gated, premium
  source is not). Otherwise well-protected.
- **Fix applied:** _pending Phase 3_ — add explicit pre-open trust assertion returning a
  structured block reason.

### 5. Signal engine internals / tiers
- `deriveTradeClass` / `isAutoTradeableSizingTier` (`optionSignalVetoes.ts`): TRADEABLE vs
  INFO_ONLY; STANDARD vs BASELINE. **INFO_ONLY / vetoed cannot open trades** (already
  enforced). No change beyond surfacing reasons.

### 6. P25 evidence gate
- **Backend/Frontend:** `foCockpitView.ts` (`deriveP25EvidenceDetail`, `summarizeFoCockpit`,
  `P25_THRESHOLD=20`) + `FoP25EvidencePanel`.
- **Current behavior:** gates the **"Official" status of performance stats** (needs ≥20
  MFE-available trades); it does **not** currently block an individual paper-trade open.
- **SIG:** reporting-quality gate, not a per-trade execution gate.
- **Remaining limitation / decision:** the task asks that "P25 evidence insufficient"
  block a trade. Today P25 is a stats-confidence gate, not a per-open gate — turning it
  into a per-open block is a **trading-logic change** requiring explicit owner sign-off
  (it would suppress trades on under-sampled setups).

### 7. Option quote / OI fetchers
- `kiteOptionChain.ts` (`fetchKiteOptionChain`) — Kite, direct `kc.getQuote`. Approximates
  IV (Black-Scholes/Newton-Raphson) and `chgOi` (heuristic) — **derived analytics, clearly
  not "real" exchange fields**; must remain labelled as derived.
- `oiLab.ts` (`fetchOiInsights`, `fetchKiteOnlyChain`) — Kite-only enforced for OI Lab.
- **CF:** NO (these ARE the providers wrapped by the facade) &nbsp; **SYN:** IV/chgOi are
  derived (label, do not present as raw exchange data).

### 8. Futures quote path
- `kiteIndexQuotes.ts` (`getKiteIndexQuotes`) — Kite, direct `kc.getQuote`.
- **CF:** NO &nbsp; **DP:** YES &nbsp; **SYN:** NO &nbsp; **STALE:** no freshness envelope.
- **Fix applied:** _pending_ — there is no `getFuturesQuote()` facade yet; the task names
  one that does not exist.

### 9. Stop/target premium calculation
- `optionSignals.ts:1843` `projectOptionLevel` derives option entry/T1/T2/SL from the
  chain LTP × delta. **Stop/target are only as trustworthy as the chain LTP feeding them**
  → inherits the Phase-2 premium-provenance gap.

### 10. Synthetic / proxy paths touching live/paper signals
- No synthetic **premium/OI** fabrication found (fetchers return null instead). The only
  Yahoo touch on an F&O surface is the **index-spot fallback** in `getSpotForUnderlying`
  (display analytics). IV and ΔOI are **derived**, not synthetic, and must stay labelled.

---

## Named facades requested vs. reality

The task names these facades; current status:

| Facade | Exists? | Notes |
|---|---|---|
| `getOptionChain()` | YES (unused) | `marketData/optionChainProvider.ts` |
| `getOptionChainDiagnostics()` | NO | not in codebase |
| `getFnoQuote()` | NO | not in codebase |
| `getFnoQuotes()` | NO | not in codebase |
| `getFuturesQuote()` | NO | not in codebase |
| `getOptionContractQuote()` | NO | not in codebase |

---

## Top risks (prioritised)

1. **Premium-provenance gap (HIGH, SIG):** signal/stop/target premiums can originate from
   the NSE-fallback chain while the signal is labelled Kite-quality. Bar-source gating
   does not cover premium source. → Phase 2.
2. **No provenance envelope on served option-chain payloads (MED, display honesty):** UI
   infers source heuristically; no `asof`/`is_stale`/`source_provider`/`warnings`. →
   Phase 1.
3. **Yahoo index-spot on an F&O surface (MED):** acceptable for display only if labelled;
   must never reach a signal. → Phase 1 (label) + Phase 2 (gate).
4. **Missing futures/contract facades (LOW until needed):** add only where a real consumer
   needs them; do not build unused surface.

---

## Phased implementation plan (sequenced, each independently shippable + tested)

- **Phase 1 — Display provenance (LOW risk, no trade-path change).** Serve
  `/api/options/chain` + `/analytics` with a provenance envelope (`source_provider`,
  `source_priority`, `asof`, `freshness_sec`, `is_stale`, `warnings`, `missing_reason`).
  Surface source badge / freshness / stale + missing-OI warnings in `option-chain.tsx`
  from the real envelope (no fake rows). Tests: facade Kite-primary, no synthetic rows,
  stale labelled.
- **Phase 2 — Signal premium-provenance gate (HIGH value, trade-path; fail-closed).**
  Stamp the option-chain source onto each signal; block/demote any official signal whose
  premium/OI is not trusted Kite, with an exact reason. Tests: NSE/Yahoo-premium chain
  cannot produce a TRADEABLE signal; missing OI demotes when required.
- **Phase 3 — Paper-open trust assertion (fail-closed).** Add an explicit pre-open
  assertion returning `{ trade_open_allowed:false, reason }` covering: source untrusted,
  contract unresolved, premium missing, OI missing where required, data stale, expiry/
  strike mismatch, lot size missing, provider conflict. Tests: each reason path.
- **Phase 4 — Facades on demand.** Add `getFuturesQuote` / `getOptionContractQuote` /
  `getOptionChainDiagnostics` only where a real consumer is migrated onto them.
- **Owner sign-off items (do NOT change without explicit approval):**
  - Making **P25 evidence insufficiency** a per-trade open block (currently a stats gate).
  - **Removing the NSE-direct chain fallback** for the display page (NSE is a real source;
    restricting to Kite-only changes UX when Kite is offline).

---

## Regression budget (must stay green throughout)

- `pnpm run typecheck`
- `pnpm --filter @workspace/api-server run test --pool=threads`
- `pnpm --filter @workspace/scanner run test --pool=threads` (incl. Watchlist, Portfolio,
  Home/Market-Pulse, candle-source honesty)
