# Phase A0.3 — Index-F&O Setup Viability and Honest Retirement

**Programme:** F&O Signal-Fabrication Defect Programme (A-series)
**Phase:** A0.3
**Date:** 2026-07-27
**Predecessor phases accepted at:** A0.1 = 4af42c1f, A0.2 = b611fd26
**PRE_TASK_HEAD:** 31d09223a7f79e674dc65e66e3637ba5138b7b2b (main)

---

## §1 — Scope Statement

Phase A0.3 replaces three "active but structurally dead" index-F&O setups with an explicit, machine-readable unavailability contract. No thresholds, weights, signal substitutes, or strategy parameters were changed. No deploy/push/DB writes were performed.

Setups addressed:
1. `VOLUME_BREAKOUT` — always structurally dead (zero-volume cash indices)
2. `MEAN_REVERSION` — always structurally dead (no session VWAP; effectiveVwap=spot proxy removed)
3. `TREND_CONTINUATION` (no-VWAP branch) — structurally dead (max conf 35 < 50 threshold)

The VWAP-available `TREND_CONTINUATION` path (base conf 45, reachable ≥50) is **ACTIVE** and was not modified.

---

## §2 — Pre-edit Classification (authoritative, not amended)

### VOLUME_BREAKOUT

**Classification:** `ACTIVE_BUT_STRUCTURALLY_DEAD`

Root cause — three independent null/false boundaries:

1. **A0.2 boundary:** `volumeProfile()` pre-scan returns `null` when `totalVol = 0` (cash indices always have zero volume). The `buildContext` caller receives `vp: null`.
2. **A0.1 boundary:** `buildContext` passes `isIndexFno: true` + `vp: null` to `confluenceEngine`; engine blocks VP scoring unconditionally.
3. **Arithmetic boundary (intraday):** `volOk = lastVol > avgVol20 * 1.2 = 0 > 0 = false`; `momentumOk = spot > effectiveVwap = spot > spot = false` (effectiveVwap proxy).

`detectVolumeBreakout` line 930: `if (!c.vp) return null` — first explicit guard; already present pre-A0.3.

Silent null, no reason code, no API exposure.

### MEAN_REVERSION

**Classification:** `ACTIVE_BUT_STRUCTURALLY_DEAD`

Root cause — `A0_2_RESIDUAL_PROPAGATION_GAP_DISCOVERED_IN_A0_3`:

`buildContext` sets `effectiveVwap = vwapRaw ?? spot`. For cash indices, `vwapRaw = null` → `effectiveVwap = spot`.

`detectMeanReversion` pre-A0.3:
```typescript
const dist = c.spot - c.vwap;         // = spot - spot = 0
const extendedUp = dist > atr15 * 2;  // 0 > positive → false
const extendedDn = dist < -atr15 * 2; // 0 < negative → false
if (!extendedUp && !extendedDn) return null; // line 1074 — always fires
```

Both extension conditions permanently false. Function always returns null silently.

This is a downstream propagation of the A0.2 VWAP-unavailable case: A0.2 blocked the indicator pre-scan but did not remove the spot-as-VWAP proxy from the decision path inside `detectMeanReversion`.

### TREND_CONTINUATION (no-VWAP branch)

**Classification:** `ACTIVE_BUT_STRUCTURALLY_DEAD`

Root cause — confidence arithmetic ceiling below threshold:

```
Generic theoretical maximum:   EMA stack(20) + RSI healthy(15) + vol-confirm(8) = 43
Cash-index operational maximum: EMA stack(20) + RSI healthy(15) + vol-confirm(0) = 35
```

vol-confirm requires `lastVol > avgVol20 * 1.2` = `0 > 0` = false for all cash indices. Both 43 and 35 are below the branch threshold of 50. The branch is therefore permanently non-emitting for cash indices.

The pre-A0.3 codebase described this as "active fallback" — incorrect.

---

## §3 — Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Reason codes | VOLUME_BREAKOUT → `INDEX_VOLUME_UNAVAILABLE`; MEAN_REVERSION → `SESSION_VWAP_UNAVAILABLE`; no-VWAP TC → `SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY` | From prompt §7; machine-readable, stable across deploys |
| Defence-in-depth layers | Orchestration gate (loop skip) + detector guard (detectMeanReversion) | Both layers must independently fail closed |
| Preserve generic 43 and operational 35 | Both recorded (A0.1 evidence not rewritten; A0.3 evidence adds operational proof) | Honest record; two truths, not one |
| Schema path | openapi.yaml is source; api-zod generated file updated manually | orval v8.5.3 pattern; generated file must match YAML |
| TREND_CONTINUATION availability condition | Only add entry when `!vwapAvailable`; VWAP-available path remains ACTIVE | Correct and forward-compatible |
| Empty map fallback in getOptionSignals | Seed map when all indices suppressed before buildSignalsForIndex | Ensures availability is always in API response |
| Live-setup count | Not incremented by unavailable setups | Unavailable setups are not live |

---

## §4 — Files Modified

| File | Change type |
|---|---|
| `artifacts/api-server/src/lib/optionSignals.ts` | Add `IndexFnoSetupAvailability` interface; add `computeIndexFnoSetupAvailability`; extend `IndexBuildResult`; extend `OptionSignalsResult`; add guard in `detectMeanReversion`; add setupAvailability pre-flight + loop gate in `buildSignalsForIndex`; accumulate in `getOptionSignals`; add map fallback |
| `lib/api-spec/openapi.yaml` | Add `FnoSetupAvailabilityEntry` schema; add `indexFnoSetupAvailability` to `FnoSetupState` |
| `lib/api-zod/src/generated/api.ts` | Add Zod shape for `indexFnoSetupAvailability` in `setupState` object |
| `artifacts/api-server/src/routes/scanner.ts` | Destructure and include `indexFnoSetupAvailability` in route's `setupState` |
| `artifacts/scanner/src/pages/options.tsx` | Add setup-availability disclosure strip |
| `artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts` | Update Test E comment (classification string only; no assertion changes) |

---

## §5 — Files Created

| File | Purpose |
|---|---|
| `artifacts/api-server/src/lib/optionSignals.setupAvailability.test.ts` | Full §10 matrix: VOLUME_BREAKOUT, MEAN_REVERSION, no-VWAP TC, VWAP-available TC, shared boundary invariants, stability, A0_2_RESIDUAL_PROPAGATION_GAP |
| `artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md` | This file |

---

## §6 — Implementation Evidence: computeIndexFnoSetupAvailability

A pure function taking `vwapAvailable: boolean`. Returns:

**vwapAvailable = false (cash-index reality):**
```
[
  { setupKey: "VOLUME_BREAKOUT",      status: "UNAVAILABLE_REQUIRED_INPUT",  reasonCode: "INDEX_VOLUME_UNAVAILABLE" },
  { setupKey: "MEAN_REVERSION",       status: "UNAVAILABLE_REQUIRED_INPUT",  reasonCode: "SESSION_VWAP_UNAVAILABLE" },
  { setupKey: "TREND_CONTINUATION",   status: "RETIRED_INDEX_FNO_POLICY",    reasonCode: "SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY" },
]
```

**vwapAvailable = true (hypothetical):**
```
[
  { setupKey: "VOLUME_BREAKOUT",      status: "UNAVAILABLE_REQUIRED_INPUT",  reasonCode: "INDEX_VOLUME_UNAVAILABLE" },
  { setupKey: "MEAN_REVERSION",       status: "UNAVAILABLE_REQUIRED_INPUT",  reasonCode: "SESSION_VWAP_UNAVAILABLE" },
]
```

All entries: `scope: "INDEX_FNO"`, `eligibleForEmission: false`.

---

## §7 — Implementation Evidence: detectMeanReversion Guard

**Pre-A0.3 (gap):**
```typescript
function detectMeanReversion(c: Ctx): Detected | null {
  const dist = c.spot - c.vwap;  // c.vwap = effectiveVwap = spot when unavailable
  // dist = 0 → both extensions false → always null (silent)
```

**Post-A0.3 (explicit guard):**
```typescript
function detectMeanReversion(c: Ctx): Detected | null {
  // A0.3 D-FAB-07 / A0_2_RESIDUAL_PROPAGATION_GAP_DISCOVERED_IN_A0_3:
  // No substitute (spot, HLC3, close, previous VWAP, VP levels) is used.
  if (!c.vwapAvailable) return null;
  const dist = c.spot - c.vwap;
```

The spot-as-VWAP proxy is now permanently excluded from the Mean Reversion decision path. The orchestration gate in `buildSignalsForIndex` provides defence-in-depth.

---

## §8 — Implementation Evidence: Orchestration Gate in buildSignalsForIndex

Added after `const suppressed: string[] = [];` (before `if (!isMarketOpen)`):

```typescript
const setupAvailability = computeIndexFnoSetupAvailability(ctx.vwapAvailable);
const SETUP_KEY_TO_DET_NAME: Record<string, string> = {
  VOLUME_BREAKOUT: "volume_breakout",
  MEAN_REVERSION: "mean_reversion",
  TREND_CONTINUATION: "trend_continuation",
};
const retiredDetectorNames = new Set(
  setupAvailability.filter(a => a.status !== "ACTIVE")
    .map(a => SETUP_KEY_TO_DET_NAME[a.setupKey])
    .filter((n): n is string => n !== undefined),
);
```

Inside the detector loop (first check before expiry-day gate):
```typescript
if (retiredDetectorNames.has(det.name)) {
  suppressed.push(
    `${det.name}: unavailable for index F&O — ` +
    `${avEntry?.reasonCode ?? "RETIRED_INDEX_FNO_POLICY"} — ` +
    `see indexFnoSetupAvailability in API response`,
  );
  continue;
}
```

Return: `{ signals: out, suppressed, hasBars: true, snapshot: snapshotFromCtx(ctx), setupAvailability }`.
No-bars early return: `{ ..., setupAvailability: computeIndexFnoSetupAvailability(false) }`.

---

## §9 — Implementation Evidence: API Schema

### OpenAPI (lib/api-spec/openapi.yaml)

Added `FnoSetupAvailabilityEntry` schema with required fields:
- `setupKey: string`
- `status: enum [ACTIVE, UNAVAILABLE_REQUIRED_INPUT, RETIRED_INDEX_FNO_POLICY]`
- `reasonCode: string`
- `explanation: string`
- `missingInputs: array of string`
- `scope: enum [INDEX_FNO]`
- `eligibleForEmission: boolean enum [false]`

Updated `FnoSetupState` required list to include `indexFnoSetupAvailability` and added the property as an array of `$ref: "#/components/schemas/FnoSetupAvailabilityEntry"`.

### Zod (lib/api-zod/src/generated/api.ts)

Added `indexFnoSetupAvailability` as `zod.array(zod.object({...}))` inside the `setupState` object, matching the OpenAPI schema exactly.

---

## §10 — Implementation Evidence: Route Handler (scanner.ts)

Updated `getOptionSignals()` destructure:
```typescript
const { signals, diagnostics, indexFnoSetupAvailability } = await getOptionSignals();
```

Updated `setupState` object:
```typescript
indexFnoSetupAvailability: indexFnoSetupAvailability ?? [],
```

---

## §11 — Implementation Evidence: Frontend Disclosure Strip (options.tsx)

Added after expiry-day banner, before Tab toggle. Renders only when unavailable entries exist in `data?.setupState?.indexFnoSetupAvailability`. Not included in live-setup count.

Each row shows:
- `setupKey` (font-mono, 36-char column)
- `explanation` (full sentence)
- `reasonCode` (font-mono, muted, right-aligned)

Uses `Ban` icon from the already-imported lucide-react set. `data-testid="fno-setup-availability-strip"`.

---

## §12 — Test Evidence: Unit Tests

### Non-regression suite

Files run:
- `optionSignals.setupAvailability.test.ts` (new)
- `optionSignals.zeroVolume.test.ts` (Test E comment updated)
- (Results recorded in §15 below after execution)

### New test coverage (optionSignals.setupAvailability.test.ts)

Test groups:
- §10.1: vwapAvailable=false — 7 tests (entry count, present/absent setupKeys)
- §10.2: vwapAvailable=true — 4 tests (entry count, TC absent when VWAP active)
- §10.3: VOLUME_BREAKOUT properties — 10 tests (status, reasonCode, scope, eligibleForEmission, explanation, missingInputs)
- §10.4: MEAN_REVERSION properties — 9 tests (including cross-variant consistency)
- §10.5: TREND_CONTINUATION (no-VWAP) — 8 tests (inc. 35/50 in explanation, TC absent when VWAP=true)
- §10.6: Shared boundary invariants — 7 tests (all entries)
- §10.7: Stability — 4 tests (deterministic across two calls, count delta)
- §10.8: A0_2_RESIDUAL_PROPAGATION_GAP — 2 tests (MEAN_REVERSION never ACTIVE, proxy language)

Total: 51 tests in new file.

### Test E comment update (zeroVolume.test.ts)

Classification changed from:
```
TARGET_RESULT_INVARIANCE_NOT_APPLICABLE_UNDER_CURRENT_NON_EMITTING_BRANCH
```
to:
```
RETIRED_FOR_INDEX_FNO_UNAVAILABLE_AUTHORITATIVE_INPUT — resolved in Phase A0.3
```

No assertion changes. The non-emitting reality (all VP variants return null) is preserved.

---

## §13 — Non-Regression Invariants Confirmed

1. **No threshold changes.** The emission threshold of 50 is not modified.
2. **No weight changes.** EMA(20), RSI(15), vol-confirm(8) weights are not modified.
3. **No signal substitutes.** No proxy, fallback, or fabricated input is introduced.
4. **A0.1 guards untouched.** `isIndexFno` guard in confluenceEngine; `vp:null` caller policy; VP confluence quarantine (D-FAB-03/04).
5. **A0.2 pre-scans untouched.** `sessionVwap()` and `volumeProfile()` pre-scan fail-closed contracts.
6. **C0 kill-switch untouched.**
7. **VWAP-available TREND_CONTINUATION remains ACTIVE.** No entry in availability list for it.
8. **VWAP_RECLAIM remains ACTIVE.** Not touched.
9. **EMA_PULLBACK remains ACTIVE.** Not touched.
10. **detectVwapReclaim untouched.**
11. **detectEmaPullback untouched.**
12. **detectBaselineOutlook untouched.**
13. **confluenceEngine.ts untouched.**
14. **No DB writes.** Schema-only change; no migration triggered.
15. **No deploy/push.**

---

## §14 — A0.3 Three-Surface Agreement Verification

The **same** `setupAvailability` object from `computeIndexFnoSetupAvailability` is the source for all three surfaces:

| Surface | How it receives the data | Guard |
|---|---|---|
| Orchestration loop | `retiredDetectorNames` set from `setupAvailability` in `buildSignalsForIndex` | Detector skipped if name in set |
| API response | `IndexBuildResult.setupAvailability` → `getOptionSignals()` → `OptionSignalsResult.indexFnoSetupAvailability` → `scanner.ts` setupState | Always present (fallback for all-suppressed case) |
| UI disclosure strip | `data?.setupState?.indexFnoSetupAvailability` from React Query | Renders when `status !== "ACTIVE"` entries exist |

No divergent lists. All three surfaces share the same reason codes.

---

## §15 — Final Git Pass (recorded after execution)

### Test Suite Results

**Normal order:** 4 test files, 213 tests — all passed.
```
Test Files  4 passed (4)
Tests  213 passed (213)
```

**Reverse order:** 4 test files, 213 tests — all passed (order-independent).

Files in the non-regression suite:
- `src/lib/indicators.test.ts`
- `src/lib/confluenceEngine.vwapGuard.test.ts`
- `src/lib/optionSignals.setupAvailability.test.ts` (new — 53 tests)
- `src/lib/optionSignals.zeroVolume.test.ts` (Test E comment updated — assertions unchanged)

New tests added: 53 in `optionSignals.setupAvailability.test.ts`.
Pre-existing tests unchanged: 160 from the other 3 files.

### Typecheck Results

- `@workspace/api-server`: `tsc --noEmit` — clean (exit 0)
- `@workspace/scanner`: `tsc --noEmit` — clean (exit 0)
- `@workspace/api-zod`: `tsc --noEmit` — clean (exit 0)

Note: `@workspace/api-client-react` was rebuilt (`tsc` compile with `emitDeclarationOnly`) after updating `api.schemas.ts`, so the scanner could resolve the new `FnoSetupAvailabilityEntry` type from the updated `dist/` declarations.

### git diff --stat HEAD

```
 artifacts/api-server/src/lib/optionSignals.ts      | 227 ++++++++++++++++++++-
 artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts |  21 +-
 artifacts/api-server/src/routes/scanner.ts         |   6 +-
 artifacts/scanner/src/pages/options.tsx            |  38 ++++
 lib/api-client-react/src/generated/api.schemas.ts  |  42 ++++
 lib/api-spec/openapi.yaml                          |  47 ++++-
 lib/api-zod/src/generated/api.ts                   |  38 ++++
 lib/api-zod/src/generated/types/fnoSetupState.ts   |   7 +
 lib/api-zod/src/generated/types/index.ts           |   1 +
 9 files changed, 413 insertions(+), 14 deletions(-)
```

New files created (not in diff as they are untracked at time of stat):
- `artifacts/api-server/src/lib/optionSignals.setupAvailability.test.ts`
- `artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md`
- `lib/api-zod/src/generated/types/fnoSetupAvailabilityEntry.ts`

---

END OF PHASE A0.3 SETUP VIABILITY AND HONEST RETIREMENT RECORD
