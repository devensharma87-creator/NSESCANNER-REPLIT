# Phase B1.1 — Canonical Live-Market Data Backbone: Evidence File

**Phase:** B1.1  
**Closure gates:** C1 (Future-timestamp honesty), C2 (Fallback provenance from real routing), C3 (Full verification battery)  
**Status:** ACCEPTED  
**Accepted at:** 2026-07-31  
**Acceptance terminator:** `ACCEPT_B1_1_CANONICAL_LIVE_DATA_BACKBONE`  
**Activation note:** `PROVIDER_ACTIVATION_PENDING — UPSTOX / INDIANAPI NOT_CONFIGURED`

---

## 1. What Was Built

### 1.1 `lib/marketData/providerCapability.ts` (new)

Formal capability registry. `ProviderCapabilityState` enum (AVAILABLE / NOT_CONFIGURED / AUTH_EXPIRED / UNSUPPORTED / DEGRADED / RATE_LIMITED / UNAVAILABLE) per provider + domain. `getProviderCapabilities()` is synchronous, makes zero network calls, exposes no credential values. Exposed via `/system/mode` response and `/api/data/diagnostics`.

### 1.2 `lib/marketData/freshness.ts` (extended — C1 gate)

**B1.1-C1 fix:** Removed the `Math.max(0, ...)` clamp that silently treated future timestamps as `ageSec=0` (fresh). Replaced with an explicit `FUTURE_TIMESTAMP` classification gate.

**New exports:**
- `CLOCK_SKEW_TOLERANCE_SEC = 5` — named, centralised constant. Derived from `clockDrift.ts` `DRIFT_ALERT_MS = 1000 ms` plus buffer for symmetric provider-side drift and network latency (MAX_RTT_FOR_RELIABLE_PROBE_MS). Any provider timestamp more than 5 s in the future fails the honesty check.
- `Freshness.rawAgeSec: number | null` — signed, unclamped age; negative = future.
- `Freshness.isFutureTimestamp: boolean` — explicit classification flag.
- `Freshness.clockSkewSec: number | null` — signed skew preserved for diagnostics.

**Behaviour matrix:**

| Condition | `isFutureTimestamp` | `isStale` | `freshnessSec` |
|---|---|---|---|
| `asOfMs = null / NaN` | `false` | `true` | `null` |
| `rawAgeSec >= -TOLERANCE` (within tolerance, minor skew) | `false` | by budget | clamped ≥ 0 |
| `rawAgeSec < -TOLERANCE` (materially future) | **`true`** | **`true`** | **`null`** |

### 1.3 `lib/marketData/types.ts` (extended — C1 gate)

Added `isFutureTimestamp?: boolean` (optional, additive) to `DataMeta` interface. Absent when not a future-timestamp situation. Present and `true` when the provider timestamp was materially in the future.

### 1.4 `lib/marketData/validator.ts` (extended — C1 gate)

`buildMeta()` now propagates `isFutureTimestamp` from the `Freshness` result:
- Sets `validationStatus = "stale"` when `fresh.isFutureTimestamp = true`.
- Adds a warning message naming the measured skew in seconds.
- Propagates `isFutureTimestamp: true` into the returned `DataMeta` (omitted when `false`).

### 1.5 `lib/marketData/optionChainProvider.ts` (extended — C1 + C2 gates)

**B1.1-C1 gate in `fetchKiteOnly`:** After building the option chain metadata, explicitly checks `meta.isFutureTimestamp === true`. Returns `ok: false` with reason `"FUTURE_TIMESTAMP: ..."` before entering the cache. This means:
- Future-stamped chains never reach the cache.
- Future-stamped chains never power TRADE_DECISION / PAPER_ADMISSION / EXIT_MONITORING paths.
- The gate is fail-closed: `ok: false` → downstream code reads `null` chain → `buildOptionChainProvenance(null, ...)` → `trustedForSignals: false` → `premiumTrustVerdict(...).trusted: false`.

**C2 routing correctness (pre-existing, now proven by tests):**
- TRADE_GRADE mode (`fetchKiteOnly`): Kite-only, no NSE fallback. `meta.fallbackUsed = false` is set by `buildOptionChainMeta` because `opts.isNseFallback = false`.
- DISPLAY mode (`fetchWithFallback`): Kite primary, NSE second. If Kite fails and NSE succeeds, `opts.isNseFallback = true` → `meta.fallbackUsed = true`, `meta.notForSignals = true`, `meta.notForTradeDecisions = true`, `meta.visualOnly = true`.

### 1.6 `lib/optionSignals.ts` — TRADE_GRADE migration (previously delivered)

Both `fetchOptionChain()` calls migrated to `getOptionChain("TRADE_GRADE", ...)`. No runtime import of `fetchOptionChain`. Proven:

```
grep "^import.*fetchOptionChain" lib/optionSignals.ts  →  NONE — fully migrated
```

### 1.7 `lib/paperTradingCombo.ts` — TRADE_GRADE migration (previously delivered)

Single `fetchOptionChain()` call migrated to `getOptionChain("TRADE_GRADE", ...)`. No runtime import. Proven:

```
grep "^import.*fetchOptionChain" lib/paperTradingCombo.ts  →  NONE — fully migrated
```

### 1.8 Intentionally deferred (non-TRADE_GRADE paths)

| File | Reason deferred |
|---|---|
| `lib/preMarket.ts` (3 calls) | Display path — NSE fallback intentional; not a trade signal source |
| `lib/dataParity/observe.ts` (2 calls) | Observation/parity path — not a signal or paper-trade path |

---

## 2. Gate C1 — Future-Timestamp Honesty: Evidence

### 2.1 Boundary test results (§B1.1-C1, 13 tests)

All 13 injected-clock boundary cases in `b1.canonical.test.ts`:

| Test | Scenario | Expected | Result |
|---|---|---|---|
| C1-01 | timestamp = now | `isFutureTimestamp=false`, `freshnessSec=0` | ✓ PASS |
| C1-02 | 1s in future (within tolerance) | `isFutureTimestamp=false`, clamped to 0 | ✓ PASS |
| C1-03 | (TOLERANCE-1)s in future (inside) | `isFutureTimestamp=false` | ✓ PASS |
| C1-04 | exactly TOLERANCE seconds in future | `isFutureTimestamp=false` (boundary inclusive) | ✓ PASS |
| C1-05 | (TOLERANCE+0.1)s in future | `isFutureTimestamp=true`, `freshnessSec=null` | ✓ PASS |
| C1-06 | 1 hour in future | `isFutureTimestamp=true`, `isStale=true` | ✓ PASS |
| C1-07 | exactly at fresh/stale boundary | `isStale=false` | ✓ PASS |
| C1-08 | 1s beyond stale boundary | `isStale=true` | ✓ PASS |
| C1-09 | missing timestamp (null) | `isStale=true`, `freshnessSec=null` | ✓ PASS |
| C1-10 | NaN timestamp | `isStale=true`, `freshnessSec=null` | ✓ PASS |
| C1-11 | freshly received prior-session timestamp | `isStale=true`, `isHardStale=true` | ✓ PASS |
| C1-12 | future chain → TRADE_DECISION | `ok=false`, reason=FUTURE_TIMESTAMP | ✓ PASS |
| C1-13 | future chain → PAPER_ADMISSION / EXIT blocked | `trustedForSignals=false` | ✓ PASS |

---

## 3. Gate C2 — Fallback Provenance from Real Routing: Evidence

### 3.1 Routing test results (§B1.1-C2, 8 tests via mocked transports)

All tests exercise the production facades (`getOptionChain()`) with mocked `fetchKiteOptionChain` and `fetchOptionChain (NSE)` — no manually injected `fallbackUsed: true`.

| Test | Scenario | Expected | Result |
|---|---|---|---|
| C2-01 | Kite success / TRADE_GRADE | `fallbackUsed=false`, `source=kite`, `ok=true` | ✓ PASS |
| C2-02 | Kite throws / TRADE_GRADE | `ok=false`; NSE NOT called | ✓ PASS |
| C2-03 | Kite success / DISPLAY | `fallbackUsed=false`, `source=kite` | ✓ PASS |
| C2-04 | Kite throws + NSE success / DISPLAY | `fallbackUsed=true`, `notForSignals=true`, `visualOnly=true` | ✓ PASS |
| C2-05 | NSE DISPLAY fallback → provenance gate | `trustedForSignals=false`, `trusted=false` | ✓ PASS |
| C2-06 | Both fail / DISPLAY | `ok=false` | ✓ PASS |
| C2-07 | Upstox/IndianAPI NOT_CONFIGURED | state=NOT_CONFIGURED; no kite mock called | ✓ PASS |
| C2-08 | Migrated consumer path (TRADE_GRADE) | Correct provenance → `trustedForSignals=true` | ✓ PASS |

### 3.2 Migration proof: no runtime `fetchOptionChain` in trade-sensitive consumers

```
grep "^import.*fetchOptionChain" lib/optionSignals.ts     → NONE
grep "^import.*fetchOptionChain" lib/paperTradingCombo.ts → NONE

grep -n "getOptionChain" lib/optionSignals.ts:
  line 15: import { getOptionChain } from "./marketData/optionChainProvider"
  line 2469: await getOptionChain(first.index, "TRADE_GRADE", expiry)
  line 2995: await getOptionChain(cfg.symbol, "TRADE_GRADE", expiry)

grep -n "getOptionChain" lib/paperTradingCombo.ts:
  line 46: import { getOptionChain } from "./marketData/optionChainProvider"
  line 173: await getOptionChain(underlying, "TRADE_GRADE", expiry)
```

---

## 4. Gate C3 — Full Verification Battery

### 4.1 Test suites

| Suite | Files | Tests | Result |
|---|---|---|---|
| api-server (full, `--pool=threads`) | 211 | **4 435** | ✓ PASS |
| scanner (`vitest run`) | 39 | **843** | ✓ PASS |
| b1.canonical.test.ts (targeted) | 1 | **67** | ✓ PASS |

### 4.2 TypeScript checks (all 5 packages, `--noEmit`)

| Package | Result |
|---|---|
| `artifacts/api-server` | ✓ CLEAN |
| `artifacts/global` | ✓ CLEAN |
| `artifacts/scanner` | ✓ CLEAN |
| `lib/api-client-react` | ✓ CLEAN |
| `lib/api-zod` | ✓ CLEAN |

### 4.3 Production builds (3)

| Artifact | Result |
|---|---|
| `artifacts/api-server` (`pnpm run build`) | ✓ PASS |
| `artifacts/global` (`pnpm run build`) | ✓ PASS |
| `artifacts/scanner` (`pnpm run build`) | ✓ PASS |

### 4.4 DB isolation tripwire

`DB_TEST_RUNTIME_AUTHORIZED=false` — zero DB connections in b1.canonical.test.ts (confirmed by no output from the tripwire command). `T41` in §11.7 asserts this inline.

### 4.5 Zero live-provider proof

All network transports (`fetchKiteOptionChain`, `fetchOptionChain/NSE`) are mocked via `vi.mock()` in `b1.canonical.test.ts`. `T40` confirms `vi.mock` is in effect. `T42` confirms `getProviderCapabilities()` makes zero network calls.

### 4.6 Git whitespace check

```
git diff --check  →  GIT_CHECK_CLEAN
```

---

## 5. File SHA-256 Checksums

| File (relative to `src/lib/marketData/`) | SHA-256 |
|---|---|
| `freshness.ts` | `48ba048286206890ce272d773be427b6d8432fb236f0b5744348220e5b9c1170` |
| `validator.ts` | `46941e54420139c3e0b1f9ae7ed1a244021da44adcccc67b254d4dc85ad0f077` |
| `types.ts` | `7a97feaf63f07af4124462607d8b9f053fc95f902a0551767e7e4fe33bf80818` |
| `optionChainProvider.ts` | `0ac31f695ee2ef010a35a9987639489bf23237d299947dcf4222b98ac193bf2e` |
| `b1.canonical.test.ts` | `3475d65dcfb0df5e89f61e40cc954062851f8a8911f8da7d124f571d8dd9ffd5` |

---

## 6. Provider Activation Status

| Provider | Domain | State |
|---|---|---|
| kite | All trade-sensitive domains | AVAILABLE (session active) / AUTH_EXPIRED (session inactive) |
| upstox | option_chain, index_quote, … | **NOT_CONFIGURED** — `UPSTOX_API_KEY/SECRET/ACCESS_TOKEN` absent |
| indianapi | index_quote, equity_quote | **NOT_CONFIGURED** — `INDIANAPI_KEY` absent |
| yahoo | All | UNSUPPORTED (trade) / AVAILABLE (analytics) |
| nse | option_chain | AVAILABLE (display fallback only; never TRADE_GRADE) |

`PROVIDER_ACTIVATION_PENDING — UPSTOX / INDIANAPI NOT_CONFIGURED`

---

## 7. Acceptance Verdict

All three closure gates are satisfied:
- **C1:** `computeFreshness` correctly classifies future timestamps as `isFutureTimestamp=true, isStale=true, freshnessSec=null`. Gate is propagated through `DataMeta` and enforced in `fetchKiteOnly` (fail-closed for TRADE_GRADE). 13/13 boundary tests pass.
- **C2:** Production routing proved via real facades with mocked transports. `fallbackUsed`, `notForSignals`, `notForTradeDecisions`, `visualOnly` are all set by the routing code, not injected manually. 8/8 routing tests pass.
- **C3:** 4435 + 843 = 5278 total tests pass. 5 TSC clean. 3 builds clean. Zero DB. Zero live providers. Git clean.

`ACCEPT_B1_1_CANONICAL_LIVE_DATA_BACKBONE`  
`PROVIDER_ACTIVATION_PENDING — UPSTOX / INDIANAPI NOT_CONFIGURED`

---

`END_PHASE_B1_1_FRESHNESS_AND_ACCEPTANCE_CLOSURE`
