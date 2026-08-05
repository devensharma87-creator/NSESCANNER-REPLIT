# Fast-Track Pack 7 — Provider Activation, Shadow Parity & Cross-Tab Canonicalization
## Evidence File

**Pack ref:** Pack 7 (Prompt 26)
**Evidence date:** 2026-08-05
**Evaluator:** Replit Agent

---

## Gate 0A — Missing Viewport Screenshots (Prompt 25C carryover)

Seven surfaces were missing from the p25c screenshot set. All 21 screenshots (7 surfaces × 3 viewports) are now captured.

**Captured this session (previously missing):**
| Surface | Desktop | Tablet | Mobile |
|---|---|---|---|
| 01 – Paper Trading FNO | ✅ existed | **✅ new** | ✅ existed |
| 02 – Paper Trading Intraday Report | **✅ new** | ✅ existed | **✅ new** |
| 05 – OI Lab | ✅ existed | **✅ new** | **✅ new** |
| 06 – Home Global Cues / US VIX | ✅ existed | **✅ new** | ✅ existed |
| 07 – Swing Staged Orders | ✅ existed | **✅ new** | ✅ existed |

**Screenshot directory:** `artifacts/audit-evidence/screenshots/p25c/`
**Total screenshots in p25c:** 21

**GATE 0A: PASS**

---

## Gate 0B — OI Lab Schema-Valid Fixtures + 5-State Visual Proof

### Fixture rebuild
`artifacts/scanner/src/mocks/fetchInterceptor.ts` was completely rebuilt for OI Lab:
- `delayMs` field added to `FixtureEntry` type; `interceptedFetch` supports it for LOADING state
- URL param `?oifix=<state>` routes to the correct fixture: LOADING / RENDERED / NO_SNAPSHOTS / BUFFER_WARMING / ERROR
- Fixed field names (`oi` not `callOi`/`putOi`) in topResistance/topSupport arrays
- Added all previously-missing required fields: `intradayFlow`, `marketInsight`, `analysis`, `maxPainDeviation`, `prevClose`, `kind`

### Visual evidence
| State | Screenshot | Description |
|---|---|---|
| LOADING | `screenshots/p26/gate0b-oi-lab-loading.jpg` | 12 skeleton cards visible during 8s delay |
| RENDERED | `screenshots/p26/gate0b-oi-lab-rendered.jpg` | Full OverviewTab with real snapshot data |
| NO_SNAPSHOTS | `screenshots/p26/gate0b-oi-lab-no-snapshots.jpg` | "No snapshots buffered" (bufLen=0) message |
| BUFFER_WARMING | `screenshots/p26/gate0b-oi-lab-buffer-warming.jpg` | "Buffer warming" indicator |
| ERROR | `screenshots/p26/gate0b-oi-lab-error.jpg` | Error banner visible |

### Tests
- **File:** `artifacts/scanner/src/lib/p26.gate0b.oiLabStates.test.ts`
- **Tests:** 40 passing
- Covers: pure-function state resolver, bufLen=0 text logic, fixture field completeness, screenshot directory counts (Gate 19), global exclusion (Gate 20), sentiment band coverage

**GATE 0B: PASS**

---

## Gate 3 — Shadow Non-Interference (G8-1 to G8-10)

### Verified
- `UPSTOX_ANALYTICS_TOKEN` takes precedence over `UPSTOX_ACCESS_TOKEN` in `resolveUpstoxConfig()`
- `authMode` field (`ANALYTICS_TOKEN | STANDARD_DAILY_TOKEN | NOT_CONFIGURED`) correctly set per token presence
- Whitespace-only tokens trim to null → `NOT_CONFIGURED`
- `getShadowRoutingState("upstox")` returns `"NOT_CONFIGURED"` with no live tokens (correct)
- Shadow dispatch is `Promise<void>` — fire-and-forget, result never used by callers
- Source scan: no shadow provider imports in trade-path files
- Global artifact directory untouched; `parityClassification.ts` lives only in api-server

### Tests
- **File:** `artifacts/api-server/src/lib/p26.gate3.shadowNonInterference.test.ts`
- **Tests:** 37 passing

**GATE 3: PASS**

---

## Gate 4 — IndianAPI Entitlement, Plan/Host Validation (G4-1 to G4-10, G8-11, G8-12)

### Plan/host map (`INDIANAPI_PLAN_HOST`)
| Plan | Host |
|---|---|
| FREE | stock.indianapi.in |
| HOBBY | stock.indianapi.in |
| DEVELOPER | dev.indianapi.in |
| GROWTH_ANALYST | analyst.indianapi.in |
| PRO | pro.indianapi.in |

### Verified
- Valid plan + matching host → `configState: "VALID"`
- Invalid plan string → `configState: "INVALID_PROVIDER_CONFIG"` with configError (no key leak)
- Mismatched host for plan → `INVALID_PROVIDER_CONFIG`
- API key absent → `configState: "VALID"`, `isIndianApiConfigured() === false`
- `getStock()` uses `/stock?name=` endpoint exclusively (verified by source scan)
- Raw API key never exposed in `indianApiHealth()` or capability manifest
- IndianAPI tagged as `reference/analytics`, never `trade-grade`
- `detectIndianApiPlan()` (local helper): detects all 5 valid plan strings, returns null for unknown

### Tests
- **File:** `artifacts/api-server/src/lib/p26.gate4.indianApiEntitlement.test.ts`
- **Tests:** 46 passing

**GATE 4: PASS**

---

## Gate 5 — Parity Classification Model (G5-1 to G5-9)

### New module: `artifacts/api-server/src/lib/marketData/parityClassification.ts`
- **`ParityClassification`** — 9-value enum: `MATCH_WITHIN_TOLERANCE | PRICE_DIVERGENCE | TIMESTAMP_DIVERGENCE | INSTRUMENT_MISMATCH | STALE_PROVIDER | FUTURE_TIMESTAMP | FIELD_MISSING | PROVIDER_UNAVAILABLE | NOT_COMPARABLE`
- **`PARITY_THRESHOLDS`** — `PRICE_BPS_TOLERANCE=50`, `TIMESTAMP_SKEW_SEC=120`, `STALE_PROVIDER_SEC=300`, `FUTURE_TOLERANCE_SEC=5`
- **`ParityObservation`** — `zeroTradingImpact: true` (literal type; monitoring only)
- **`classifyParityObservation()`** — deterministic 5-tier classification
- **`aggregateObservations()`** — 50th/95th percentile roll-up with `withinTolerance` ratio
- **`percentile()`** — exact calculation for sorted input arrays

### Monitoring-only guarantee
The file header and comment explicitly state:
> "Shadow provider data has no trading impact; zeroTradingImpact is always true."

All classifications are MONITORING-ONLY — never affect trading, signals, paper trades, P&L, or broker.

### Tests
- **File:** `artifacts/api-server/src/lib/p26.gate5.parityModel.test.ts`
- **Tests:** 55 passing
- Covers all 9 classifications, NaN/Infinity/zero edge cases, percentile utility, aggregateObservations

**GATE 5: PASS**

---

## Gate 6 — Cross-Tab Canonicalization (G6-1 to G6-5, G8-16)

### Verified (source inspection)
- `router.ts` is the single market-data authoritative source — no shadow provider imported directly
- Scanner pages/components do not import `upstoxProvider` or `indianApiProvider` directly
- Market status is sourced from a single endpoint across all surfaces
- `asOf` field propagates from router through to scan rows — no tab divergence
- Global exclusion (Gate 20): global artifact directory unmodified

### Tests
- **File:** `artifacts/api-server/src/lib/p26.gate6.crossTabEquality.test.ts`
- **Tests:** 46 passing

**GATE 6: PASS**

---

## Gate 7 — Diagnostics Auth & Shadow Impact (G7-1 to G7-8, G8-17, G8-18)

### Source changes to `providerDiagnostics.ts`
Added to the `GET /api/providers/diagnostics` response:
```json
{
  "shadowImpactStatement": "Shadow provider data has no trading, signalling, paper-trading, P&L or broker impact.",
  "shadowState": {
    "upstox": {
      "authMode": "NOT_CONFIGURED",   ← safe; not the token itself
      ...
    },
    "indianapi": {
      "plan": null,
      "configState": "VALID",
      ...
    }
  }
}
```

### Verified
- `requireOwnerStrict` middleware applied on all 4 provider diagnostic routes
- `authMode` field exposed instead of raw token value
- Raw token env vars (`UPSTOX_ANALYTICS_TOKEN`, `UPSTOX_ACCESS_TOKEN`, `KITE_API_KEY`) never passed to response JSON
- `zeroTradingImpact: true` literal in `ParityObservation` interface
- Shadow impact statement present in route source and `parityClassification.ts` header comment
- `getParitySummary("upstox")` returns `sampleCount ≥ 0`
- Anonymous access → `requireOwnerStrict` → 403 (AUTH_REQUIRED)

### Tests
- **File:** `artifacts/api-server/src/lib/p26.gate7.diagnosticsAuth.test.ts`
- **Tests:** 24 passing

**GATE 7: PASS**

---

## Gate 9 — Environment / Live Activation Status

```
PRESENT:  (none)
MISSING:  UPSTOX_ANALYTICS_TOKEN, UPSTOX_ACCESS_TOKEN, INDIANAPI_API_KEY, INDIANAPI_PLAN
```

No shadow credentials are present in the development environment. The shadow routing infrastructure is fully implemented but activation requires providing the credentials as secrets.

```
GATE_9_VERDICT: LIVE_SHADOW_OBSERVATION_BLOCKED — MISSING: UPSTOX_ANALYTICS_TOKEN, UPSTOX_ACCESS_TOKEN, INDIANAPI_API_KEY, INDIANAPI_PLAN
```

**GATE 9: BLOCKED (credentials absent — expected in dev; infrastructure ready)**

---

## Gate 19 — Screenshot Evidence Directory Counts

| Directory | Count | Requirement |
|---|---|---|
| `artifacts/audit-evidence/screenshots/p25c/` | 21 | 21 (7 surfaces × 3 viewports) |
| `artifacts/audit-evidence/screenshots/p26/` | 5 | 5 (OI Lab states) |

**GATE 19: PASS**

---

## Gate 20 — Global Artifact Exclusion

The `artifacts/global` directory was not modified during Pack 7.  
`parityClassification.ts` lives only in `artifacts/api-server/src/lib/marketData/`.  
Gate 6 source inspection confirms no shadow imports in global artifact.

**GATE 20: PASS**

---

## Test Floor Summary

| Package | Prior floor | New floor | Delta |
|---|---|---|---|
| api-server | 5,673 | **5,881** | +208 |
| scanner | 1,210 | **1,250** | +40 |

**New test files introduced this pack:**
- `artifacts/api-server/src/lib/p26.gate3.shadowNonInterference.test.ts` — 37 tests
- `artifacts/api-server/src/lib/p26.gate4.indianApiEntitlement.test.ts` — 46 tests
- `artifacts/api-server/src/lib/p26.gate5.parityModel.test.ts` — 55 tests
- `artifacts/api-server/src/lib/p26.gate6.crossTabEquality.test.ts` — 46 tests
- `artifacts/api-server/src/lib/p26.gate7.diagnosticsAuth.test.ts` — 24 tests
- `artifacts/scanner/src/lib/p26.gate0b.oiLabStates.test.ts` — 40 tests

---

## TypeScript Typecheck

```
4-package TSC --noEmit: CLEAN (0 errors)
Packages: api-server, scanner, global, lib/api-client-react
```

---

## Source Files Modified / Created

| File | Action | Purpose |
|---|---|---|
| `artifacts/scanner/src/mocks/fetchInterceptor.ts` | Modified | OI Lab fixtures rebuild: 5 states, delayMs, correct field names |
| `artifacts/api-server/src/lib/marketData/parityClassification.ts` | Created | Gate 5 parity model: 9 classifications, thresholds, pure functions |
| `artifacts/api-server/src/routes/providerDiagnostics.ts` | Modified | Added authMode + shadowImpactStatement to diagnostics response |
| `artifacts/api-server/src/lib/p26.gate3.shadowNonInterference.test.ts` | Created | 37 tests for Gates G8-1 to G8-10 |
| `artifacts/api-server/src/lib/p26.gate4.indianApiEntitlement.test.ts` | Created | 46 tests for Gates G4-1 to G4-10, G8-11, G8-12 |
| `artifacts/api-server/src/lib/p26.gate5.parityModel.test.ts` | Created | 55 tests for Gate G5 parity model |
| `artifacts/api-server/src/lib/p26.gate6.crossTabEquality.test.ts` | Created | 46 tests for Gates G6-1 to G6-5, G8-16 |
| `artifacts/api-server/src/lib/p26.gate7.diagnosticsAuth.test.ts` | Created | 24 tests for Gates G7-1 to G7-8, G8-17, G8-18 |
| `artifacts/scanner/src/lib/p26.gate0b.oiLabStates.test.ts` | Created | 40 tests for Gate 0B OI Lab states |
| `artifacts/audit-evidence/screenshots/p25c/` | Modified | 7 missing screenshots added (21 total) |
| `artifacts/audit-evidence/screenshots/p26/` | Created | 5 OI Lab state screenshots |

---

## Overall Verdict

| Gate | Result |
|---|---|
| Gate 0A — Missing p25c screenshots | ✅ PASS |
| Gate 0B — OI Lab fixtures + 5-state proof | ✅ PASS |
| Gate 3 — Shadow non-interference | ✅ PASS |
| Gate 4 — IndianAPI entitlement | ✅ PASS |
| Gate 5 — Parity classification model | ✅ PASS |
| Gate 6 — Cross-tab canonicalization | ✅ PASS |
| Gate 7 — Diagnostics auth + shadow impact | ✅ PASS |
| Gate 9 — Live activation status | ⚠️ BLOCKED (credentials absent — expected) |
| Gate 19 — Screenshot directories | ✅ PASS |
| Gate 20 — Global exclusion | ✅ PASS |
| TSC clean | ✅ PASS |
| Test floors (api-server 5881, scanner 1250) | ✅ PASS |

```
ACCEPT_FAST_TRACK_PACK_7_SHADOW_PARITY_IMPLEMENTED_LIVE_ACTIVATION_PENDING
```

END_FAST_TRACK_PACK_7_PROVIDER_ACTIVATION_SHADOW_PARITY_AND_CROSS_TAB_CANONICALIZATION
