---
name: B1.1 Canonical Live-Market Data Backbone
description: Key decisions and constraints from B1.1 implementation — provider capability registry, consumer migrations, accepted deferred paths.
---

# B1.1 Canonical Live-Market Data Backbone

**Accepted:** 2026-07-31  
**Verdict:** `B1_1_ACCEPTED_WITH_PROVIDER_ACTIVATION_PENDING`

## What was done

1. **`lib/marketData/providerCapability.ts`** (new) — formal `ProviderCapabilityState` enum (AVAILABLE/NOT_CONFIGURED/AUTH_EXPIRED/UNSUPPORTED/DEGRADED/RATE_LIMITED/UNAVAILABLE) per provider+domain. `getProviderCapabilities()` is synchronous, no network calls, no credentials in output. Exposed via `/system/mode` and `/api/data/diagnostics`.

2. **`optionSignals.ts` migrated** — both `fetchOptionChain()` calls (signal sweep line ~2463, IV capture line ~2987) replaced with `getOptionChain("TRADE_GRADE", ...)` from `optionChainProvider`. The canonical TRADE_GRADE mode excludes the NSE fallback that `fetchOptionChain` would allow. `buildOptionChainProvenance()` / `premiumTrustVerdict()` gates preserved unchanged.

3. **`paperTradingCombo.ts` migrated** — `fetchOptionChain()` at line ~172 replaced with `getOptionChain("TRADE_GRADE", ...)`. Failure reason forwarded from `MarketDataResult.reason`.

4. **`diagnostics.ts` extended** — `DataDiagnostics` interface now includes `providerCapabilities: ProviderCapabilitySnapshot`.

5. **`systemStatus.ts` extended** — `/system/mode` response now includes `providerCapabilities`.

6. **44 B1.1 tests** — `lib/marketData/b1.canonical.test.ts`, all 44 passing.

## Provider states (authoritative)

| Provider | State | Reason |
|----------|-------|--------|
| Kite | AVAILABLE (if session active) | Primary authoritative |
| Upstox | NOT_CONFIGURED | No env vars |
| IndianAPI | NOT_CONFIGURED | No env vars; fundamentals → B1.2 |
| Yahoo | UNSUPPORTED (trade), AVAILABLE (analytics) | analytics-only |
| NSE | AVAILABLE (option_chain display only) | Display fallback |

## NOT migrated (deferred)

- `preMarket.ts` lines 578, 1162 — display path, lower risk
- `dataParity/observe.ts` line 483 — observation path, lower risk

**Why:** Both are display/observation paths — data never drives signals, paper trades, or risk sizing. NSE fallback is intentional there.

## Key invariants

- `TRADE_SENSITIVE_DOMAINS` = index_quote, equity_quote, intraday_candles, daily_candles, option_chain (NOT instrument_master)
- `tradeAvailableProviders` only ever contains "kite" — no other provider may appear
- `computeFreshness(futureMs, nowMs)` → `ageSec = Math.max(0, ...)` — future timestamps yield ageSec=0 (not stale by freshnessSec alone); clockDrift subsystem handles skew detection
- `fallbackUsed` in `pointFromMeta` must be passed EXPLICITLY — not derived from warnings array
- `unavailableMeta(source, trustTier, reason)` takes 3 args (not 2)
