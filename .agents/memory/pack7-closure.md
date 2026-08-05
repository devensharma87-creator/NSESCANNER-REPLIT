---
name: Pack 7 closure
description: Pack 7 Provider Activation, Shadow Parity & Cross-Tab Canonicalization — final state and key decisions
---

## Key decisions

**getShadowRoutingState(provider)** — takes a `ShadowProvider` arg and returns a `ShadowRoutingState` string, NOT an object. Tests checking `.upstox` property were wrong and fixed to call `getShadowRoutingState("upstox")`.

**IndianApiHealth** — fields are `configured`, `plan`, `configState`, `lastProbeAt`, `lastError`. NO `state` or `reason` at top level. `configState` is `"VALID" | "INVALID_PROVIDER_CONFIG"` (no `NOT_CONFIGURED`). Key-absent → VALID + `isIndianApiConfigured()=false`.

**IndianApiCapabilityEntry** — fields are `domain`, `endpoint`, `state`, `notes` (not `capability`, not `note`). `IndianApiCapabilityState` does NOT include `"UNAVAILABLE"`.

**IndianApiPlan values** — FREE, HOBBY (both → stock.indianapi.in), DEVELOPER, GROWTH_ANALYST, PRO. NOT STOCK, DEV, ANALYST.

**resolveIndianApiConfig()** — includes `apiKey` field in return value. Key presence/absence checked via `isIndianApiConfigured()`, not by inspecting the config object for absence of the field.

**parityClassification.ts** — lives only in api-server, not in global artifact. `ParityObservation.zeroTradingImpact: true` is a literal type. File header contains "no trading impact" text for regex tests.

**providerDiagnostics.ts** — now includes `shadowImpactStatement` and `authMode` in the GET /api/providers/diagnostics response body.

**File path CWD in tests:**
- api-server vitest CWD = `artifacts/api-server/` → use `"src/lib/..."` not `"artifacts/api-server/src/lib/..."`
- scanner vitest CWD = `artifacts/scanner/` → use `"src/..."` and `"../audit-evidence/..."` 
- Cross-artifact from api-server: `"../scanner/..."`, `"../global/..."`

**Gate 9 verdict:** LIVE_SHADOW_OBSERVATION_BLOCKED — all 4 shadow env vars absent in dev (UPSTOX_ANALYTICS_TOKEN, UPSTOX_ACCESS_TOKEN, INDIANAPI_API_KEY, INDIANAPI_PLAN). Infrastructure complete, activation requires credentials.

## Final floors
- api-server: 5881 tests (265 files) — up +208 from 5673
- scanner: 1250 tests (52 files) — up +40 from 1210
- 4-pkg TSC: clean

## New test files
- p26.gate3.shadowNonInterference.test.ts (37)
- p26.gate4.indianApiEntitlement.test.ts (46)
- p26.gate5.parityModel.test.ts (55)
- p26.gate6.crossTabEquality.test.ts (46)
- p26.gate7.diagnosticsAuth.test.ts (24)
- p26.gate0b.oiLabStates.test.ts (scanner, 40)
