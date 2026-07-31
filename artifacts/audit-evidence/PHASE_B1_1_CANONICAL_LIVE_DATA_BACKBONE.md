# Phase B1.1 — Canonical Live-Market Data Backbone
## Production State & Implementation Evidence

**Phase:** B1.1  
**Prompt:** Prompt 17  
**Acceptance verdict:** `B1_1_ACCEPTED_WITH_PROVIDER_ACTIVATION_PENDING`  
**Date:** 2026-07-31

---

## §1 Provider Inventory and Capability States

### Kite Connect (Primary / Authoritative)
- **Status:** AVAILABLE (session active) | AUTH_EXPIRED (creds present, session inactive) | NOT_CONFIGURED (creds absent)
- **Trust tier:** `authoritative` — the ONLY source permitted to power signals, paper trades, F&O valuation, and risk sizing
- **Domains:** index_quote, equity_quote, intraday_candles, daily_candles, instrument_master, option_chain, market_status
- **Session model:** Daily Zerodha login required; token encrypted at rest (`KITE_TOKEN_ENC_KEY`)
- **Credentials:** `KITE_API_KEY` ✓ `KITE_API_SECRET` ✓ `KITE_TOKEN_ENC_KEY` ✓ (all present per preflight)

### Upstox (Secondary — NOT_CONFIGURED)
- **Status:** NOT_CONFIGURED
- **Reason:** `UPSTOX_API_KEY` / `UPSTOX_API_SECRET` / `UPSTOX_ACCESS_TOKEN` absent in this deployment
- **Activation prerequisite:** Configure credentials and implement the Upstox adapter (B1.2 or later)
- **Fabrication guard:** No synthetic responses, no adapter code, no simulated success
- **Capability registry:** All domains report NOT_CONFIGURED with explicit reason string

### IndianAPI / INDstocks (Secondary — NOT_CONFIGURED)
- **Status:** NOT_CONFIGURED
- **Reason:** `INDIANAPI_KEY` / `INDSTOCKS_API_KEY` absent
- **Scope note:** Fundamentals, news, FII-DII deferred to B1.2
- **Fabrication guard:** Existing INDstocks scaffold is present but disabled (`isIndstocksEnabled()=false`); no calls made

### Yahoo Finance (Analytics only — UNSUPPORTED for trade domains)
- **Status:** AVAILABLE for `daily_candles` (analytics); UNSUPPORTED for all trade-sensitive domains
- **Trust tier:** `secondary_analytics` — NEVER powers prices, signals, valuation, or F&O
- **Stamp:** `delayed=true`, `notForSignals=true`, `notForTradeDecisions=true` enforced at `buildMeta()` call site
- **Consumer:** `analyticsYahoo.ts` — explicitly labelled; no crossover to trusted paths

### NSE Public Scrape (Display fallback — AVAILABLE for option_chain only)
- **Status:** AVAILABLE for `option_chain` display mode only
- **Trust tier:** Display fallback; `notForSignals=true` enforced by `optionChainProvenance.ts` (`classifyOcSource("nse") ≠ "kite"`)
- **Trade gate:** `premiumTrustVerdict()` rejects NSE-sourced chains for any paper-trade or signal use

---

## §2 Canonical Envelope — DataMeta (Accepted, Unchanged)

`DataMeta` (in `lib/marketData/types.ts`) is the authoritative per-datum envelope:

| Field | Purpose | B1.1 Status |
|-------|---------|-------------|
| `source: ProviderName` | Upstream provider | ✅ Always set, never null |
| `trustTier: TrustTier` | authoritative / secondary_validation / secondary_analytics | ✅ Enforced at buildMeta() |
| `asOf: string \| null` | Exchange/quote timestamp (ISO) | ✅ Null = stale |
| `fetchedAt: string` | Application receipt time (ISO) | ✅ Always Date.now() at fetch |
| `freshnessSec: number \| null` | Age in seconds (now − asOf) | ✅ Null when asOf unknown |
| `isStale: boolean` | Older than freshnessBudgetSec (90s default) | ✅ Computed by computeFreshness() |
| `delayed: boolean` | Yahoo analytics = always true | ✅ Enforced at call site |
| `notForSignals: boolean` | Hard gate against signal use | ✅ Yahoo/NSE = always true |
| `notForTradeDecisions: boolean` | Hard gate against trade use | ✅ Derived from notForSignals |
| `validationStatus` | validated / stale / incomplete / unavailable | ✅ Set by buildMeta() |
| `warnings: string[]` | Degradation/fallback notes | ✅ Never silent |

**`MarketDataResult<T>`** wraps all provider calls: `{ ok, data: T | null, meta: DataMeta, reason?: string }`.

**`sourceStatusFromMeta(meta, hasValue)`** maps DataMeta → `SourceStatus` (TRADE_GRADE / DELAYED / INFO_ONLY / STALE / UNAVAILABLE).

**`pointFromMeta(input)`** bridges DataMeta into `MarketDataPoint<T>` for the unified backbone envelope.

---

## §3 New Files Created

### `lib/marketData/providerCapability.ts` (NEW — B1.1 §7)

Formal capability registry with:
- **`ProviderCapabilityState`** enum: `AVAILABLE | NOT_CONFIGURED | AUTH_EXPIRED | UNSUPPORTED | DEGRADED | RATE_LIMITED | UNAVAILABLE`
- **`DataDomain`** type: `index_quote | equity_quote | intraday_candles | daily_candles | instrument_master | option_chain | market_status`
- **`getProviderCapabilities()`** — synchronous, pure read, zero network calls, zero credentials in output
- **`getCapabilityFor(provider, domain, snap?)`** — lookup with UNAVAILABLE fallback for unknown combinations
- **`TRADE_SENSITIVE_DOMAINS`** — the five domains that require authoritative (Kite) sourcing
- **`ProviderCapabilitySnapshot`** — includes `tradeAvailableProviders` (Kite-only by policy) and `authoritative: "kite"`
- Exposed via `/system/mode` (new `providerCapabilities` field) and `/api/data/diagnostics` (new `providerCapabilities` field in `DataDiagnostics`)

### `lib/marketData/b1.canonical.test.ts` (NEW — 44 tests)

All 44 required B1.1 test scenarios. **Result: 44/44 PASS**.

---

## §4 Highest-Risk Consumer Migrations

### `lib/optionSignals.ts` — F&O signal sweep + IV capture (MIGRATED)

**Before (legacy bypass):**
```typescript
import { fetchOptionChain } from "./optionChain";
// ...
const chain = await fetchOptionChain(first.index, expiry);  // line 2463
// ...
const chain = await fetchOptionChain(cfg.symbol, expiry);   // line 2987
```

**After (canonical TRADE_GRADE):**
```typescript
import { getOptionChain } from "./marketData/optionChainProvider";
// ...
const _ocResult = await getOptionChain(first.index, "TRADE_GRADE", expiry);
const chain = _ocResult.ok ? (_ocResult.data?.chain ?? null) : null;
// ...
const _ivOcResult = await getOptionChain(cfg.symbol, "TRADE_GRADE", expiry);
const chain = _ivOcResult.ok ? (_ivOcResult.data?.chain ?? null) : null;
```

**Why this matters:** `fetchOptionChain()` (legacy) fetches Kite first, then falls back to the NSE public scrape for DISPLAY purposes. The TRADE_GRADE mode in `optionChainProvider` explicitly excludes the NSE fallback path — a non-Kite chain cannot reach the premium enrichment loop. The downstream `buildOptionChainProvenance()` + `premiumTrustVerdict()` gate is preserved as-is; the canonical provider adds defence-in-depth.

The `reason` from `MarketDataResult` is also forwarded to `buildOptionChainProvenance`'s `missingReason` option for honest failure propagation.

### `lib/paperTradingCombo.ts` — Paper combo admission (MIGRATED)

**Before:**
```typescript
import { fetchOptionChain } from "./optionChain";
const chain = await fetchOptionChain(underlying, expiry);
if (!chain) { return { ok: false, code: "CHAIN_UNAVAILABLE", ... }; }
```

**After:**
```typescript
import { getOptionChain } from "./marketData/optionChainProvider";
const _ocResult = await getOptionChain(underlying, "TRADE_GRADE", expiry);
const chain = _ocResult.ok ? (_ocResult.data?.chain ?? null) : null;
if (!chain) {
  return { ok: false, code: "CHAIN_UNAVAILABLE", message: _ocResult.reason ?? `...` };
}
```

---

## §5 Lower-Priority Legacy `fetchOptionChain` Calls (In-Place, Not Yet Migrated)

Two display/observation paths still use `fetchOptionChain` directly:
- `lib/preMarket.ts` (lines 578, 1162) — pre-market assessment, display-only
- `lib/dataParity/observe.ts` (line 483) — data parity observation

These are lower-risk (display paths, not trade-sensitive). They are NOT migrated in B1.1 because:
1. Both are display/observation paths — the data never drives signals, paper trades, or risk sizing
2. Their use of NSE fallback is intentional and appropriate for display
3. Migration would require adding DISPLAY-mode `getOptionChain()` calls (which already exist in `optionChainProvider`) — deferred to a targeted cleanup task

---

## §6 Diagnostics Extensions

### `/system/mode` (GET, owner-only) — new `providerCapabilities` field
```json
{
  "mode": { ... },
  "clockDrift": { ... },
  "tokenStaleness": { ... },
  "instrumentsIntegrity": { ... },
  "providerCapabilities": {
    "evaluatedAt": "2026-07-31T08:57:03.123Z",
    "authoritative": "kite",
    "tradeAvailableProviders": ["kite"],
    "capabilities": [
      { "provider": "kite", "domain": "index_quote", "state": "AVAILABLE", "reason": "Live: 987 quotes...", "evaluatedAt": "..." },
      { "provider": "upstox", "domain": "index_quote", "state": "NOT_CONFIGURED", "reason": "UPSTOX_API_KEY / ... absent...", "evaluatedAt": "..." },
      ...
    ]
  }
}
```

### `/api/data/diagnostics` (GET, owner-only) — new `providerCapabilities` field in `DataDiagnostics`

`DataDiagnostics.providerCapabilities: ProviderCapabilitySnapshot` added alongside the existing `providers` (legacy ProviderState) and `indstocks` fields.

---

## §7 Server-Side Market-Status Freshness (Carry-forward from B0)

The `/api/options/signals` route computes `marketStatus` exclusively from `computeMarketStatus(new Date())` and `getMarketStatusDetail(now)` — both are IST session-calendar functions driven by server system time. They do NOT depend on browser-side React Query `dataUpdatedAt`.

The option chain data freshness is classified by `optionChainProvider`'s `OptionChainMeta` via the `evaluateOptionChain()` function, which checks:
- Contract expiry against `nowDay` (IST-aware)
- Chain completeness (`rows.length > 0`, finite `spot`)
- `generatedAt` asOf timestamp → `isoToMs()` → fed to `computeFreshness()`

The `marketStatus` field in the response is **server-authoritative** — it is never derived from client-side stale data.

---

## §8 Test Battery Results

| Suite | Files | Tests | Result |
|-------|-------|-------|--------|
| B1.1 canonical (new) | 1 | 44 | ✅ 44/44 PASS |
| Full api-server (all) | 211 | 4412 | ✅ 4412/4412 PASS |
| TypeScript: api-server | — | — | ✅ CLEAN |
| TypeScript: scanner | — | — | ✅ CLEAN |

---

## §9 Acceptance Verdict

```
B1_1_ACCEPTED_WITH_PROVIDER_ACTIVATION_PENDING

Provider capability states (all explicit, no fabrication):
  Kite:       AVAILABLE (session active) | AUTH_EXPIRED | NOT_CONFIGURED
  Upstox:     NOT_CONFIGURED — UPSTOX_API_KEY/SECRET/ACCESS_TOKEN absent
  IndianAPI:  NOT_CONFIGURED — INDIANAPI_KEY absent; fundamentals/news deferred to B1.2
  Yahoo:      AVAILABLE (analytics) | UNSUPPORTED (trade-sensitive domains)
  NSE:        AVAILABLE (option_chain display fallback only)

Consumer migrations:
  optionSignals.ts:    MIGRATED — fetchOptionChain → getOptionChain("TRADE_GRADE") × 2
  paperTradingCombo.ts: MIGRATED — fetchOptionChain → getOptionChain("TRADE_GRADE") × 1
  preMarket.ts:        DEFERRED (display path, lower risk)
  dataParity/observe:  DEFERRED (observation path, lower risk)

No strategy formula changes. No DB runtime lock changes.
No commit/push/deploy in this session.
DB_TEST_RUNTIME_AUTHORIZED = false as boolean (unchanged).
```

---

END_PHASE_B1_1_CANONICAL_LIVE_DATA_BACKBONE_ACCEPTANCE
