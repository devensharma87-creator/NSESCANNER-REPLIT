# F&O / Option-Chain Signal-Safety Audit

**Scope:** Audit and migrate F&O / option-chain consumers onto the trusted central
market-data layer, and guarantee that no official signal or paper-trade decision is
made from stale, synthetic, missing, Yahoo, or otherwise untrusted option data.

**Status:** Phases 1–3 SHIPPED (2026-06-10). Display provenance, signal premium-provenance
gate, and the fail-closed paper-open trust assertion are implemented and tested. Phase 4
(on-demand facades) remains deferred. Owner decisions on NSE display fallback and P25 are
recorded below. Implementation phases are sequenced at the end.

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
- **Fix applied (Phase 1, 2026-06-10):** `GET /api/options/chain/:underlying` now attaches a
  `provenance` envelope (`buildOptionChainProvenance`) — `source_provider`, `source_priority`,
  `asof`, `freshness_sec`, `is_stale`, `fallback_used`, `leg_count`/`oi_leg_count`,
  `trusted_for_signals`, `warnings`, `missing_reason`. `option-chain.tsx` renders an explicit
  "NSE FALLBACK · DISPLAY ONLY" badge + a sentence ("does NOT feed official signals or paper
  trades"), plus STALE and PARTIAL-OI badges, all driven by the real envelope (no fake rows).
- **Owner decision (2026-06-10):** KEEP NSE as a labelled display fallback (never silent,
  never feeds signals/trades). Resolved — not restricted to Kite-only.

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
- **Fix applied (Phase 2, 2026-06-10):** `enrichBundlesWithOptionLevels` now builds
  `buildOptionChainProvenance(chain)` once per bundle and stamps `premiumSource` /
  `premiumTrusted` / `premiumWarning` onto every signal. When premium is NOT Kite-trusted
  (NSE/Yahoo/unknown/stale/expired/missing) the signal is demoted to `tradeClass="INFO_ONLY"`,
  tagged `PREMIUM_UNTRUSTED`, and option stop/target levels are **not** projected (the
  function returns before `projectOptionLevel`). Separately, the IVR/IVP history snapshot is
  now Kite-only (`classifyOcSource(chain.source)==="kite"`) so NSE/Yahoo IV can never pollute
  signal confidence.

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
- **Fix applied (Phase 3, 2026-06-10):** `openPaperTrade` now carries a fail-closed
  premium-provenance backstop immediately after the INFO_ONLY tier gate: an open is permitted
  **only** when `signal.premiumTrusted === true`. Anything else — NSE/Yahoo fallback, unknown
  source, stale, missing chain, or an unenriched signal (`premiumTrusted === undefined`) — is
  refused with the new `PREMIUM_UNTRUSTED` skip reason (logged with `premiumSource` /
  `premiumWarning`) and recorded as a missed signal. This is defense-in-depth: the open path
  gates on sizing *tier*, not `tradeClass`, so this explicit assertion — not the Phase-2
  demotion — is what guarantees no untrusted option premium ever opens a paper trade.
  Enrichment provably runs before `tryOpenPaperTrades` in the tick, so the field is always
  stamped.

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
- **Owner decision (2026-06-10) — RESOLVED:** P25 insufficiency must **NOT** block paper
  opens (avoids suppressing trades on under-sampled / cold-start setups). It continues to
  gate only the **OFFICIAL / validated status** of performance stats. This is exactly the
  existing behavior: `deriveP25OfficialEvidence` (`foCockpitView.ts`) exposes
  `gateStatus: "OPEN" | "THRESHOLD_MET"` / `thresholdMet` off the server's official
  `mfeAvailableCount` (threshold 20) — i.e. an under-sampled setup is already surfaced as
  "evidence gate open" (not officially validated) without ever blocking an open. No per-open
  P25 block was added. Real data-quality / liquidity / DD / premium-trust gates still
  hard-block independently.

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

- **Phase 1 — Display provenance (LOW risk, no trade-path change). ✅ SHIPPED 2026-06-10.**
  `/api/options/chain` now serves a `provenance` envelope (`source_provider`,
  `source_priority`, `asof`, `freshness_sec`, `is_stale`, `fallback_used`, `leg_count`/
  `oi_leg_count`, `trusted_for_signals`, `warnings`, `missing_reason`). `option-chain.tsx`
  renders source/fallback/stale/partial-OI badges + a "display only; not used for official
  signals or trades" sentence from the real envelope (no fake rows).
- **Phase 2 — Signal premium-provenance gate (HIGH value, trade-path; fail-closed). ✅
  SHIPPED 2026-06-10.** Each signal is stamped `premiumSource`/`premiumTrusted`/
  `premiumWarning`; non-Kite-trusted premium demotes the signal to `INFO_ONLY` (tagged
  `PREMIUM_UNTRUSTED`) and suppresses stop/target projection. IVR/IVP history is Kite-only.
  **Per-leg trust (added 2026-06-10):** even on a Kite-trusted chain, the SPECIFIC traded
  leg must carry a real premium anchor (finite positive LTP) AND open interest; a leg with
  missing/non-positive LTP or missing/zero OI sets `premiumTrusted=false` for that signal,
  demotes it to `INFO_ONLY` + `PREMIUM_UNTRUSTED`, and skips level projection — satisfying
  "missing premium/OI must demote" at the signal layer (the per-open `FNO_LIQUIDITY` OI≥50k
  gate already hard-blocks the trade itself, so this is belt-and-braces).
- **Phase 3 — Paper-open trust assertion (fail-closed). ✅ SHIPPED 2026-06-10.**
  `openPaperTrade` refuses any open unless `premiumTrusted === true`, with the new
  `PREMIUM_UNTRUSTED` skip reason. Defense-in-depth over the Phase-2 demotion (open path
  gates on sizing tier, not tradeClass). **Reconcile path hardened (2026-06-10):**
  `reconcileMissingPaperTrades` (mid-day-restart backfill of still-live triggers) builds a
  synthetic signal from persisted history, which does NOT store the premium source. It now
  re-derives current trust from a fresh chain per index (`buildOptionChainProvenance`,
  cached) and stamps `premiumTrusted`/`premiumSource` onto the synthetic signal, so the same
  fail-closed backstop re-opens legitimate Kite-trusted rows after a restart while still
  refusing any row whose premium is not currently Kite-trusted.
- **Phase 4 — Facades on demand.** Add `getFuturesQuote` / `getOptionContractQuote` /
  `getOptionChainDiagnostics` only where a real consumer is migrated onto them. _Deferred —
  no consumer needs them yet._
- **Residual test-gap (follow-up).** `enrichBundlesWithOptionLevels` and
  `reconcileMissingPaperTrades` are private / DB-and-chain-bound, so the two newest behaviors
  (per-leg OI/LTP demotion; reconcile trust re-derivation) are currently covered only
  transitively (provenance unit tests + the fail-closed open backstop + full typecheck/suite).
  Path-level tests that exercise reconcile-reopen (trusted vs untrusted vs fetch-fail) and
  traded-leg demotion would lock these in; they require exporting the internals or a DB
  fixture and are intentionally out of this task's scope.
- **Owner sign-off items — RESOLVED 2026-06-10:**
  - **P25 evidence insufficiency stays a stats / OFFICIAL-status gate, NOT a per-open block**
    (owner decision; avoids suppressing cold-start / under-sampled setups). No change made.
  - **KEEP the NSE-direct chain fallback** for the display page, clearly labelled as a
    display-only fallback that never feeds signals/trades (owner decision). Implemented in
    Phase 1.

---

## Regression budget (must stay green throughout)

- `pnpm run typecheck`
- `pnpm --filter @workspace/api-server run test --pool=threads`
- `pnpm --filter @workspace/scanner run test --pool=threads` (incl. Watchlist, Portfolio,
  Home/Market-Pulse, candle-source honesty)
