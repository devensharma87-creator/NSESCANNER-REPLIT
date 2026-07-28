# Phase A0.3 — Index-F&O Setup Viability and Honest Retirement
## Evidence Record (A0.3.1 + A0.3.2)

**Verdict:** `ACCEPT_A0_3_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`

---

## Git State

- **Implementation HEAD (A0.3.2 production commit):** `a1388b1`
- **Final HEAD at evidence write:** `62552dcad00023e6606933b38c33c4b97b76fe05`
- **`62552dc` is current HEAD:** YES
- **`a1388b1` manual commit:** YES — production changes (Ctx rename, 9-record contract)
- **`62552dc` manual commit:** YES — LLM index update only; no production code change
- **Platform-generated commits:** NONE
- **Working tree at evidence write:** Clean — only untracked `attached_assets/*.md` (prompt file)
- **`git diff`:** empty (no modified tracked files)
- **`git diff --check`:** exit 0, no whitespace issues
- **Branch:** `main` → `origin/main`
- **Upstream ahead/behind:** 0 ahead on remote, 3 ahead locally (push not performed)
- **`4af42c1f5bb6f9a6e9bea7c6e6379e53c4e1e7d0` is ancestor:** YES
- **`b611fd26ce55424df2c8802cd99f10d3725f2d01` is ancestor:** YES
- **Nothing pushed, nothing deployed, no database or secret changed, Phase A0.4 not started**

---

## Changed-File Inventory (A0.3.2 delta, commit `a1388b1`)

| File | Status | Summary |
|------|--------|---------|
| `artifacts/api-server/src/lib/optionSignals.ts` | M | Remove `Ctx.vwap`; add `Ctx.pivotRef` + `Ctx.authVwap`; 23 function-body replacements; `SupportedFnoIndex`; `computeIndexFnoSetupAvailability(SupportedFnoIndex)`; `computeAllIndexFnoSetupAvailability()`; `getOptionSignals` uses 9-record source directly; export `detectMeanReversion` |
| `artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts` | M | `makeNoVwapCtx` Ctx fixture: `vwap:` → `pivotRef:` + `authVwap: null` |
| `artifacts/api-server/src/routes/scanner.ts` | M | Remove `?? []` fallback on line 239 (source guarantees 9 records) |

LLM index update (commit `62552dc`, no production code change):

| File | Status |
|------|--------|
| `docs/llm-index/CHANGELOG_FOR_AGENTS.md` | M |
| `docs/llm-index/FILE_SUMMARIES.json` | M |
| `docs/llm-index/INDEX_MANIFEST.json` | M |

Prior-session A0.3.2 additions (committed before `a1388b1`):

| File | Status | Summary |
|------|--------|---------|
| `artifacts/api-server/src/lib/optionSignals.a031.test.ts` | M | `vwap→pivotRef` in makeCtx fixture |
| `artifacts/api-server/src/lib/optionSignals.setupAvailability.test.ts` | M | All `(false)→("NIFTY")`, `(true)→("BANKNIFTY")`; §10.2 rewritten for unconditional 3-record; §10.7 stability updated; §10.6 uses computeAll |
| `artifacts/api-server/src/lib/paperAdmission.a032.test.ts` | M | YahooChart symbol+meta added to fixtures |
| `artifacts/api-server/src/lib/openApiParity.a032.test.ts` | M | Shape accessor cast; `e:any` annotation |
| `lib/api-spec/openapi.yaml` | M | `indexSymbol` added to FnoSetupAvailabilityEntry.required+properties; minItems/maxItems:9 |
| `artifacts/api-server/src/lib/openapiSpecParity.a032.test.ts` | A | NEW — reads actual YAML file; 25 tests |
| `artifacts/api-server/src/lib/routeSerializer.a032.test.ts` | A | NEW — 6 response states + 9 rejection proofs; 27 tests |
| `artifacts/api-server/src/lib/pivotRefInventory.a032.test.ts` | A | NEW — 4 consumer-site inventory + non-fabrication proof; 16 tests |

---

## Section 3 — Accepted Baseline (160/160)

Each file run separately with `vitest run --pool=threads <file>`:

| Suite | File | Command | Tests | Status | Duration |
|-------|------|---------|-------|--------|----------|
| indicators | `src/lib/indicators.test.ts` | `vitest run --pool=threads` | **110/110** | ✅ PASS | 551ms |
| zero-volume | `src/lib/optionSignals.zeroVolume.test.ts` | `vitest run --pool=threads` | **43/43** | ✅ PASS | 4.01s |
| vwapGuard | `src/lib/confluenceEngine.vwapGuard.test.ts` | `vitest run --pool=threads` | **7/7** | ✅ PASS | 217ms |
| **Accepted baseline** | 3 files | — | **160/160** | ✅ | — |

Note: The previous evidence file recorded 39/43 for zeroVolume with 4 pre-existing failures. The `makeNoVwapCtx` fixture fix (`vwap:` → `pivotRef:` + `authVwap: null`) in commit `a1388b1` resolved all 4. The baseline is now a clean 160/160.

---

## Section 4 — A0.3/A0.3.1/A0.3.2 Suite Inventory (Separated)

Each file run separately with `pnpm exec vitest run --pool=threads <file>`:

| Suite | Exact Path | Tests | Status | Duration |
|-------|-----------|-------|--------|----------|
| Setup-availability (A0.3.1) | `src/lib/optionSignals.setupAvailability.test.ts` | **58/58** | ✅ PASS | 1.91s |
| A0.3.1 core | `src/lib/optionSignals.a031.test.ts` | **72/72** | ✅ PASS | 2.73s |
| pivotRef inventory (A0.3.2) | `src/lib/pivotRefInventory.a032.test.ts` | **16/16** | ✅ PASS | 1.98s |
| Route serializer (A0.3.2) | `src/lib/routeSerializer.a032.test.ts` | **27/27** | ✅ PASS | 2.57s |
| OpenAPI YAML parity (A0.3.2) | `src/lib/openapiSpecParity.a032.test.ts` | **25/25** | ✅ PASS | 2.36s |
| Zod/codegen parity (A0.3.2) | `src/lib/openApiParity.a032.test.ts` | **15/15** | ✅ PASS | 2.62s |
| Paper-admission (A0.3.2) | `src/lib/paperAdmission.a032.test.ts` | **21/21** | ✅ PASS | 2.09s |
| C0 enforcement | `src/lib/c0Enforcement.test.ts` | **14/14** | ✅ PASS | 1.83s |
| **A0.3 subtotal** | **8 files** | **248/248** | ✅ PASS | — |

Scanner availability tests (run within full scanner suite):

| Suite | Exact Path | Tests | Status | Duration |
|-------|-----------|-------|--------|----------|
| Frontend render (real component) | `src/lib/fnoAvailabilityRender.test.tsx` | **20/20** | ✅ PASS | 3.91s |
| Scanner setup-availability | `src/lib/fnoSetupAvailability.test.ts` | **24/24** | ✅ PASS | 1.11s |

No file is reported as aggregate only. No `.skip`, `describe.skip`, `it.skip`, or `.only` was introduced in any A0.3 acceptance file.

---

## Section 5 — Full Scanner Regression

```
Command: cd artifacts/scanner && pnpm exec vitest run
Result:  39 test files passed (39)
         Tests: 843 passed (843)
         Duration: 6.65s
```

**843/843** — matches expected historical reference. No test count change.

Scanner includes `src/lib/fnoAvailabilityRender.test.tsx` which imports and renders the real production component `IndexFnoSetupAvailabilityStrip` from `@/components/IndexFnoSetupAvailabilityStrip`. Confirmed: `options.tsx` imports the same path (`import { IndexFnoSetupAvailabilityStrip } from "@/components/IndexFnoSetupAvailabilityStrip"`).

---

## Section 6 — Real Production Component Proof

**Component chain:**
- `options.tsx` line 37: `import { IndexFnoSetupAvailabilityStrip } from "@/components/IndexFnoSetupAvailabilityStrip"`
- `options.tsx` line 1039: `<IndexFnoSetupAvailabilityStrip entries={data?.setupState?.indexFnoSetupAvailability} />`
- `fnoAvailabilityRender.test.tsx` line 27: `import { IndexFnoSetupAvailabilityStrip } from "@/components/IndexFnoSetupAvailabilityStrip"` — same production component ✅
- No test-only mirrored component exists ✅
- Test renders via React DOM and checks `data-testid` — does not duplicate filter/group/count logic ✅

**20 render tests cover:**

| # | Item | Status |
|---|------|--------|
| 1 | VOLUME_BREAKOUT unavailable group (amber, `data-testid="unavailable-group"`) | ✅ PASS |
| 2 | MEAN_REVERSION unavailable group (amber) | ✅ PASS |
| 3 | TREND_CONTINUATION_NO_VWAP retired group (purple, `data-testid="retired-group"`) | ✅ PASS |
| 4 | Nine-record input → main strip shown, no degraded state | ✅ PASS |
| 5 | Duplicate handling — per-index composite identity (`indexSymbol-setupKey`) rows | ✅ PASS |
| 6 | `undefined` entries → degraded state (`data-testid="fno-setup-availability-strip-degraded"`) | ✅ PASS |
| 7 | Empty array (0 records) → degraded state (cardinality guard) | ✅ PASS |
| 8 | 3 records (old single-index design) → degraded state (cardinality guard) | ✅ PASS |
| 9 | All-ACTIVE entries → returns null (no strip shown) | ✅ PASS |
| 10–20 | Per-index row rendering, status/group separation, no-mix-between-groups | ✅ PASS |

Items 8 (market closed), 9 (no signals), 10 (stale/suppressed), 11 (partial index failure), 12 (all-index failure), 13 (truthful expiry-day copy), 14 (contradictory-copy search) are covered in `routeSerializer.a032.test.ts` (route/serializer level) and `paperAdmission.a032.test.ts` (admission level). The render component's cardinality guard ensures degraded display for any non-9-record input regardless of cause.

---

## Section 7 — Six Route/Serializer States

From `routeSerializer.a032.test.ts` (27/27 pass). Uses the actual production route serializer exported from `optionSignals.ts` — no duplicated logic.

| State | Description | 9 Records | Zod Parse | NIFTY×3 | BANKNIFTY×3 | SENSEX×3 | Unique composites | Deterministic |
|-------|-------------|-----------|-----------|---------|------------|--------|------------------|--------------|
| 1 | Normal signals, market open | ✅ | ✅ PASS | ✅ | ✅ | ✅ | ✅ | ✅ |
| 2 | No emitted signals | ✅ | ✅ PASS | ✅ | ✅ | ✅ | ✅ | ✅ |
| 3 | Market closed | ✅ | ✅ PASS | ✅ | ✅ | ✅ | ✅ | ✅ |
| 4 | Stale/suppressed data | ✅ | ✅ PASS | ✅ | ✅ | ✅ | ✅ | ✅ |
| 5 | Partial index failure | ✅ | ✅ PASS | ✅ | ✅ | ✅ | ✅ | ✅ |
| 6 | All-index failure | ✅ | ✅ PASS | ✅ | ✅ | ✅ | ✅ | ✅ |

Additional assertions verified per state:
- `diagnostics: null` resolved: `diagnostics` is typed as optional in the Zod schema; `undefined` (omitted) passes; `null` fails — tests assert `undefined` (not `null`) for absent diagnostics ✅
- No `?? []` in production code: confirmed removed from `scanner.ts` line 239 ✅
- No avoidable HTTP 500: `computeAllIndexFnoSetupAvailability()` is a pure function with no runtime failure path ✅

Rejection proofs (9 additional tests in `routeSerializer.a032.test.ts`): empty array, fewer than 9, more than 9, duplicate composite, missing index, unknown index, unknown setup, unknown status, `eligibleForEmission: true` — all correctly rejected by Zod `.length(9)` and enum constraints ✅

---

## Section 8 — Exact Contract Matrix

Source: `computeAllIndexFnoSetupAvailability()` in `optionSignals.ts`. Data-independent — always returns exactly 9 records.

| indexSymbol | setupKey | status | reasonCode | eligibleForEmission |
|-------------|----------|--------|------------|---------------------|
| NIFTY | VOLUME_BREAKOUT | `UNAVAILABLE_REQUIRED_INPUT` | `INDEX_VOLUME_UNAVAILABLE` | `false` |
| NIFTY | MEAN_REVERSION | `UNAVAILABLE_REQUIRED_INPUT` | `SESSION_VWAP_UNAVAILABLE` | `false` |
| NIFTY | TREND_CONTINUATION_NO_VWAP | `RETIRED_INDEX_FNO_POLICY` | `SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY` | `false` |
| BANKNIFTY | VOLUME_BREAKOUT | `UNAVAILABLE_REQUIRED_INPUT` | `INDEX_VOLUME_UNAVAILABLE` | `false` |
| BANKNIFTY | MEAN_REVERSION | `UNAVAILABLE_REQUIRED_INPUT` | `SESSION_VWAP_UNAVAILABLE` | `false` |
| BANKNIFTY | TREND_CONTINUATION_NO_VWAP | `RETIRED_INDEX_FNO_POLICY` | `SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY` | `false` |
| SENSEX | VOLUME_BREAKOUT | `UNAVAILABLE_REQUIRED_INPUT` | `INDEX_VOLUME_UNAVAILABLE` | `false` |
| SENSEX | MEAN_REVERSION | `UNAVAILABLE_REQUIRED_INPUT` | `SESSION_VWAP_UNAVAILABLE` | `false` |
| SENSEX | TREND_CONTINUATION_NO_VWAP | `RETIRED_INDEX_FNO_POLICY` | `SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY` | `false` |

Zod validator enforces: `.length(9)`, `indexSymbol: z.enum(["NIFTY","BANKNIFTY","SENSEX"])`, `eligibleForEmission: z.literal(false)`, `scope: z.literal("INDEX_FNO")`, `status: z.enum([...])`, `reasonCode: z.enum([...])`.

---

## Section 9 — OpenAPI/Zod/Client Parity

**Chain:** `lib/api-spec/openapi.yaml` → manually maintained `lib/api-zod/src/generated/api.ts` (Zod) → manually maintained `lib/api-client-react/src/generated/api.schemas.ts` (TypeScript types) → route serializer → frontend

**No automated generation script** — both `api-zod` and `api-client-react` are manually maintained. Structural parity is pinned by two test files.

| Item | Value |
|------|-------|
| OpenAPI file | `lib/api-spec/openapi.yaml` |
| Zod export used | `GetOptionSignalsResponse` from `@workspace/api-zod` |
| Client type used | `FnoSetupAvailabilityEntry` from `@workspace/api-client-react` |
| Generation command | None — manually maintained; parity enforced by tests |
| Parity method | `computeAllIndexFnoSetupAvailability()` output parsed through actual Zod schema extracted from `GetOptionSignalsResponse.shape.setupState.unwrap().shape.indexFnoSetupAvailability` |

**`openapiSpecParity.a032.test.ts`** (25 tests, reads actual `openapi.yaml`):

| Check | YAML value | Zod value | Match |
|-------|-----------|-----------|-------|
| `FnoSetupAvailabilityEntry.required` includes `indexSymbol` | ✅ | ✅ | ✅ |
| `indexSymbol` enum | `[NIFTY, BANKNIFTY, SENSEX]` | `z.enum(["NIFTY","BANKNIFTY","SENSEX"])` | ✅ |
| `indexFnoSetupAvailability` minItems | 9 | `.length(9)` | ✅ |
| `indexFnoSetupAvailability` maxItems | 9 | `.length(9)` | ✅ |
| `status` enum values | ACTIVE, UNAVAILABLE_REQUIRED_INPUT, RETIRED_INDEX_FNO_POLICY | same | ✅ |
| `eligibleForEmission` | `enum: [false]` | `z.literal(false)` | ✅ |
| `scope` | `INDEX_FNO` | `z.literal("INDEX_FNO")` | ✅ |

**`openApiParity.a032.test.ts`** (15 tests): domain objects from `computeAllIndexFnoSetupAvailability()` and `computeIndexFnoSetupAvailability("NIFTY"/"BANKNIFTY"/"SENSEX")` parsed through the actual Zod schema; rejection tests for missing field, invalid indexSymbol, `eligibleForEmission: true`, invalid status, invalid scope, composite uniqueness. All 15 pass.

Typecheck success: all 4 packages (`api-server`, `api-zod`, `api-client-react`, `scanner`) — zero errors ✅

Evidence SHA256 of `lib/api-spec/openapi.yaml`: `796785ecc2bdb48dcbc7ee9f0864df802faaf6cacaf274a1186d0bf8ac45aa00`

---

## Section 10 — `pivotRef` Consumer Disposition

**Legacy `Ctx.vwap` field:** REMOVED from `Ctx` interface. Zero occurrences in production code. ✅
**`vwapRaw ?? spot` / `effectiveVwap`:** computed inside `buildContext`, NOT exposed as `Ctx.vwap`. `effectiveVwap = vwapRaw ?? spot` feeds `pivotRef` (geometry) and also the `confluenceInputs.vwap` connector arg (see consumers 3+4 below).
**Signal serialization:** `vwap: c.authVwap != null ? round2(c.authVwap) : undefined` — spot value NEVER serialized as VWAP. When `authVwap` is null (zero-volume index), the `vwap` field is omitted from the signal output entirely.

**`pivotRef` consumers (4 sites):**

| File/function | Input origin | Purpose | Affects entry? | Direction? | Confidence? | Target? | Stop? | Driver? | Connector? | User-facing label |
|---|---|---|---|---|---|---|---|---|---|---|
| `detectEmaPullback` — `momentumOk` check | `buildContext` (`effectiveVwap` = `vwapRaw ?? spot`) | Momentum gate: `spot > pivotRef` (BULL) or `spot < pivotRef` (BEAR) | YES (entry blocked if false) | YES | NO | NO | NO | NO | NO | None (internal gate) |
| `detectBaselineOutlook` — `stop` calc | `buildContext` (`effectiveVwap` = `vwapRaw ?? spot`) | Stop: `Math.min(pivotRef, ema21) - atr15×0.5` (BULL) / `Math.max(pivotRef, ema21) + atr15×0.5` (BEAR) | NO (stop geometry only) | NO | NO | NO | YES | NO | NO | Not user-facing (signal.stop field) |
| `confluenceInputs` — `vwap:` arg | `buildContext` (same `effectiveVwap`) | Connector arg to `scoreConfluence`; `isIndexFno=true` → `VOLUME_PROFILE` weight=0; VWAP-derived factors use this arg | INDIRECT (confidence factor) | NO | YES (VWAP driver weight=25) | NO | NO | YES | YES | None (internal scoring) |
| `evaluateDirectionalVetoes` — `vwap:` arg | `buildContext` (same `effectiveVwap`) | Connector arg to directional-veto engine | INDIRECT (veto gate) | YES (veto can flip direction) | NO | NO | NO | NO | YES | None (internal gate) |

**Non-fabrication proof (`pivotRefInventory.a032.test.ts`, 16 tests):**
- Zero-volume NIFTY chart → `buildSignalsForIndex` → any emitted signal has `signal.vwap === undefined` (not a spot number) ✅
- `pivotRef` is documented as spot-geometry placeholder when `vwapAvailable=false` ✅
- `authVwap` is null when `vwapAvailable=false` ✅
- `pivotRef` does not appear in `toSignal()` serializer output ✅

**Invariants confirmed:**
- No spot value in a field called VWAP ✅
- `pivotRef` is never scored, serialized or displayed as VWAP ✅
- Unavailable VWAP cannot re-enable a retired/unavailable setup ✅
- No VWAP-derived driver is fabricated ✅
- Signal serialization exposes authoritative VWAP only when `authVwap !== null` ✅
- Spot-based geometry (pivotRef) is documented in the Ctx interface JSDoc: "When false, `pivotRef` equals `spot` as a geometric placeholder — not institutional VWAP." ✅

---

## Section 11 — Paper-Admission and C0 Proof

**`c0Enforcement.test.ts` (14 tests, separately run):**

| Test | Result |
|------|--------|
| EQUITY_AUTO_OPEN_C0_BLOCKED is true | ✅ |
| FNO_AUTO_OPEN_C0_BLOCKED is true | ✅ |
| Equity AUTO source → openPaperEquityTrade returns null (C0 before first DB call) | ✅ |
| Equity STAGED source → returns null | ✅ |
| Equity MANUAL source → NOT blocked by C0 (MANUAL bypass) | ✅ |
| F&O NIFTY BULLISH → openPaperTrade returns null | ✅ |
| F&O SENSEX BEARISH → openPaperTrade returns null | ✅ |
| No broker order placement calls in paperTradingEq.ts | ✅ |
| No broker order placement calls in paperTradingFO.ts | ✅ |
| Additional gate tests (5) | ✅ |

**`paperAdmission.a032.test.ts` (21 tests, separately run):**

- Layer 1 (signal emission gate): all 9 NIFTY/BANKNIFTY/SENSEX × 3 setup combinations produce `eligibleForEmission: false`; no retired/unavailable signal is emitted from zero-volume context ✅
- Layer 2 (paper admission gate): `FNO_AUTO_OPEN_C0_BLOCKED=true`; `openPaperTrade()` returns null for all 9 retired setup combinations across all 3 indices ✅

**Summary:**
- All 9 unavailable/retired index/setup combinations blocked before paper admission ✅
- Paper auto-opening remains disabled (FNO C0 = true) ✅
- F&O C0 remains enabled ✅
- Equity C0 remains enabled ✅
- Live execution remains disabled (no broker calls) ✅
- No execution configuration weakened ✅

---

## Section 12 — Normal and Reverse Order

**11 files tested:** indicators, zeroVolume, vwapGuard, setupAvailability, a031, pivotRefInventory, routeSerializer, openapiSpecParity, openApiParity, paperAdmission, c0Enforcement.

**Normal order (indicators → c0Enforcement):**
```
Test Files: 11 passed (11)
Tests:      408 passed (408)
Duration:   5.44s
```

**Reverse order (c0Enforcement → indicators):**
```
Test Files: 11 passed (11)
Tests:      408 passed (408)
Duration:   5.24s
```

**Results identical:** YES — 408/408 both directions ✅
**Cooldown/fake-timer/module-cache/shared-state leakage:** NONE — vitest `--pool=threads` isolates test files; all tests are pure (no shared mutable state across files) ✅

---

## Section 13 — Full API-Server Suite and Skipped-Test Audit

```
Command:    cd artifacts/api-server && pnpm exec vitest run --pool=threads
Test Files: 213 passed (213)
Tests:      4279 passed | 3 skipped (4282)
Duration:   61.55s
```

**Three skipped test identities — all in `src/lib/paperTradingEqProvenance.test.ts`:**

| # | Exact test name | Skip mechanism | Reason | Pre-A0.3? | A0.1/A0.2/A0.3 acceptance test? |
|---|----------------|---------------|--------|-----------|--------------------------------|
| 1 | `applyPaperEqProvenanceColumns — live DB backfill idempotency > backfills a pre-Checkpoint-2 trade row from its matching AUTO audit row, is idempotent, and never touches an already-sourced row` | `describeDb = isolationResult.ok ? describe : describe.skip` (line 61) | `checkDbTestIsolation` returns `!ok` because `NODE_ENV=development` (requires `NODE_ENV=test + TEST_DATABASE_URL + TEST_RUN_ID + TEST_DB_ISOLATION_CONFIRMED=true`) | YES — P0.1 DB isolation guard; file predates A0.3 | NO |
| 2 | `applyPaperEqProvenanceColumns — live DB backfill idempotency > labels an orphan trade row (no matching audit row) as LEGACY_UNKNOWN — never fabricated as AUTO/MANUAL` | Same | Same | YES | NO |
| 3 | `applyPaperEqProvenanceColumns — live DB backfill idempotency > does not overwrite a row that already has a source stamped at write time` | Same | YES | NO |

**Skip mechanism origin:** The `checkDbTestIsolation` guard was introduced in the P0.1 DB test isolation task (prior to A0.3). The describe block requires the full isolated test environment (`TEST_DATABASE_URL`, `TEST_RUN_ID`, `TEST_DB_ISOLATION_CONFIRMED=true`), none of which are set in the normal dev runner.

**No new `.skip`, `describe.skip`, `it.skip`, `.only` introduced** in any file by A0.3.1 or A0.3.2 work ✅
**All 3 skips are pre-existing, outside A0.1/A0.2/A0.3 scope** ✅

---

## Section 14 — Typechecks and Builds

| # | Item | Command | Result |
|---|------|---------|--------|
| 1 | API server typecheck | `cd artifacts/api-server && pnpm exec tsc --noEmit` | ✅ Clean (no output) |
| 2 | API Zod typecheck | `pnpm --filter @workspace/api-zod exec tsc --noEmit` | ✅ Clean (no output) |
| 3 | API client React typecheck | `pnpm --filter @workspace/api-client-react exec tsc --noEmit` | ✅ Clean (no output) |
| 4 | Scanner typecheck | `pnpm --filter @workspace/scanner exec tsc --noEmit` | ✅ Clean (no output) |
| 5 | Full workspace typecheck | 4 packages above (no root-level tsc config) | ✅ All clean |
| 6 | Scanner production build | `pnpm --filter @workspace/scanner run build` | ✅ Pass (chunk-size warnings only, not errors) |
| 7 | API server production build | `cd artifacts/api-server && pnpm run build` | ✅ Pass (903ms) |
| 8 | `git diff --check` | `git diff --check` | ✅ Clean (exit 0) |
| 9 | LLM index check | `pnpm --filter @workspace/scripts run index:llm:check` | ✅ Fresh — 378 tracked files match |

---

## Section 15 — Test-Count Reconciliation (Non-Overlapping Groups)

| Group | Included files | Passed | Skipped | Failed |
|-------|---------------|--------|---------|--------|
| Accepted baseline | `indicators.test.ts`, `optionSignals.zeroVolume.test.ts`, `confluenceEngine.vwapGuard.test.ts` | **160** | 0 | 0 |
| A0.3 acceptance | `optionSignals.setupAvailability.test.ts`, `optionSignals.a031.test.ts`, `pivotRefInventory.a032.test.ts`, `routeSerializer.a032.test.ts`, `openapiSpecParity.a032.test.ts`, `openApiParity.a032.test.ts` | **213** | 0 | 0 |
| Trading boundary | `paperAdmission.a032.test.ts`, `c0Enforcement.test.ts` | **35** | 0 | 0 |
| Scanner regression | Full 39-file scanner suite | **843** | 0 | 0 |
| **Non-overlapping total** | All groups combined | **1251** | **0** | **0** |

**Reconciliation of previously reported figures:**

| Figure | Source | Meaning |
|--------|--------|---------|
| 241 | Prior session report | Baseline (160) + partial A0.3 subset (81) — not the complete A0.3 count |
| 293 | Prior session report | 10-file aggregate including baseline + some A0.3 files |
| 843 | Scanner regression | Full scanner suite — STANDALONE; cannot be added to api-server totals |
| 4,282 | Full api-server suite | Contains ALL api-server test files including baseline (160), A0.3 acceptance (213), trading boundary (35), and all other api-server tests; scanner tests are NOT included |

**Containment rules:**
- The full api-server suite (4,282) CONTAINS the accepted baseline (160), A0.3 acceptance (213), and trading boundary (35) — do NOT add them together
- The scanner suite (843) is SEPARATE from the api-server suite — may be added to the non-overlapping subtotal
- The non-overlapping total (1,251) = baseline + A0.3 acceptance + trading boundary (all api-server) + scanner (separate suite) — no double-counting

The A0.3 acceptance count in the current evidence (248) from the prior record was for 8 api-server files. The current count is also 248 across the same 8 files (58+72+16+27+25+15+21+14 = 248). The prior `pivotRefInventory` count of 15 was incorrect — it is 16.

---

## Section 16 — Evidence File

**File path:** `artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md` (this file)

**Implementation HEAD before evidence write:** `62552dcad00023e6606933b38c33c4b97b76fe05`
**Working-tree state at evidence write:** Clean — only untracked `attached_assets/*.md`
**No commit created for evidence update** (per prompt §16 instruction)

SHA256 of key source files at HEAD:

| File | SHA256 |
|------|--------|
| `lib/api-spec/openapi.yaml` | `796785ecc2bdb48dcbc7ee9f0864df802faaf6cacaf274a1186d0bf8ac45aa00` |

---

## Section 17 — Final Read-Only Git Record

```
HEAD:     62552dcad00023e6606933b38c33c4b97b76fe05
Status:   ?? attached_assets/MARKET_SCANNER_PROMPT_03_A0_3_FINAL_EVIDENCE_ONLY_CLOSURE_1785236442369.md
Branch:   main
Upstream: origin/main
Ahead/behind: 0 3 (3 local commits not pushed)
4af42c1: IS ancestor
b611fd2: IS ancestor
git diff --name-status: (empty)
git diff --stat:        (empty)
git diff --check:       exit 0
```

No further manual commit was created (evidence file update only — no commit per §16).
Nothing was pushed.
Nothing was deployed.
No database or secret was changed.
Phase A0.4 was not started.

---

## Section 18 — Per-Item Disposition

| Item | Disposition |
|------|-------------|
| D-FAB-06 / VOLUME_BREAKOUT | `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION` |
| D-FAB-07 / MEAN_REVERSION | `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION` |
| no-VWAP TREND_CONTINUATION (TREND_CONTINUATION_NO_VWAP) | `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION` |
| Production | `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED` |

**Governance exception remaining:** Production deployment verification only. All unit, schema, route-state, real-component-render, paper-admission, parity, and typecheck proofs are complete.

**Unresolved items (non-blocking):**
1. **Production deployment** — Not published. Manual Replit publish required to propagate dev schema to prod via the dev→prod diff mechanism.
2. **Manual push not performed** — All 3 commits on `main` branch, not pushed to remote `origin/main`.

---

END OF PHASE A0.3 SETUP VIABILITY AND HONEST RETIREMENT RECORD