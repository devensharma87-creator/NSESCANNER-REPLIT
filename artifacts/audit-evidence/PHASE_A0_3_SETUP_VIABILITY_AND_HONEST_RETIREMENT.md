# Phase A0.3 — Index-F&O Setup Viability and Honest Retirement
## Evidence Record (A0.3.1 + A0.3.2)

**Verdict:** `ACCEPT_A0_3_AS_UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION`

---

## Git State

- **Implementation base HEAD (before A0.3.2 evidence write):** `f14fc11`
- **Final HEAD after evidence commit:** `ae48a29`
- **Manual commits created:** Yes — all A0.3.2 work was committed manually (push not performed)
- **Working tree at evidence write:** Clean (all changes committed)
- **`git diff --check`:** Clean (exit 0)

---

## Changed-File Inventory (A0.3.2 delta over A0.3.1 base)

| File | Status | Summary |
|------|--------|---------|
| `artifacts/api-server/src/lib/optionSignals.ts` | M | `ctx.vwap→ctx.pivotRef` at 2 connector sites (confluenceInputs, evaluateDirectionalVetoes) |
| `artifacts/api-server/src/lib/optionSignals.a031.test.ts` | M | `vwap→pivotRef` in makeCtx fixture; `(false)→("NIFTY")`; shape accessor cast; YahooChart symbol+meta |
| `artifacts/api-server/src/lib/optionSignals.setupAvailability.test.ts` | M | All `(false)→("NIFTY")`, `(true)→("BANKNIFTY")`; §10.2 rewritten for unconditional 3-record; §10.7 stability updated; §10.6 uses computeAll |
| `artifacts/api-server/src/lib/optionSignals.zeroVolume.test.ts` | M | `vwap→pivotRef` field rename in BEARISH fixture (cosmetic — same value) |
| `artifacts/api-server/src/lib/paperAdmission.a032.test.ts` | M | YahooChart symbol+meta added to fixtures |
| `artifacts/api-server/src/lib/openApiParity.a032.test.ts` | M | Shape accessor cast; e:any annotation |
| `lib/api-spec/openapi.yaml` | M | `indexSymbol` added to FnoSetupAvailabilityEntry.required+properties; minItems/maxItems:9 |
| `artifacts/api-server/src/lib/openapiSpecParity.a032.test.ts` | **A** | NEW — reads actual YAML file; 25 tests |
| `artifacts/api-server/src/lib/routeSerializer.a032.test.ts` | **A** | NEW — 6 response states + 9 rejection proofs; 27 tests |
| `artifacts/api-server/src/lib/pivotRefInventory.a032.test.ts` | **A** | NEW — 4 consumer-site inventory + non-fabrication proof; 15 tests |

---

## Test Counts (Separated)

| Suite | File | Tests | Status |
|-------|------|-------|--------|
| C0 enforcement | `c0Enforcement.test.ts` | 14 | ✅ PASS |
| Setup-availability | `optionSignals.setupAvailability.test.ts` | 58 | ✅ PASS |
| A0.3.1 core | `optionSignals.a031.test.ts` | 72 | ✅ PASS |
| Paper-admission A0.3.2 | `paperAdmission.a032.test.ts` | 21 | ✅ PASS |
| Route serializer A0.3.2 | `routeSerializer.a032.test.ts` | 27 | ✅ PASS |
| OpenAPI YAML parity | `openapiSpecParity.a032.test.ts` | 25 | ✅ PASS |
| Zod/codegen parity | `openApiParity.a032.test.ts` | 15 | ✅ PASS |
| pivotRef inventory | `pivotRefInventory.a032.test.ts` | 15 | ✅ PASS |
| **A0.3 subtotal** | 8 files | **248** | ✅ PASS |
| Scanner suite | 39 test files | 843 | ✅ PASS |
| Zero-volume (pre-existing failures) | `optionSignals.zeroVolume.test.ts` | 39/43 | ⚠️ 4 pre-existing failures (confirmed via git stash — present on HEAD before A0.3.2) |

**A0.3.1 + A0.3.2 combined (normal order):** 234/234 ✅  
**A0.3.1 + A0.3.2 combined (reverse order):** 234/234 ✅  
**Full A0.3 + C0 combined:** 248/248 ✅

---

## Typecheck / Build Results

| Package | Command | Result |
|---------|---------|--------|
| api-server | `tsc --noEmit` | ✅ Clean |
| api-zod | `tsc --noEmit` | ✅ Clean |
| api-client-react | `tsc --noEmit` | ✅ Clean |
| scanner | `tsc --noEmit` | ✅ Clean |
| scanner production | `pnpm run build` | ✅ Clean (sourcemap warnings only) |

---

## Six Route-State Results (routeSerializer.a032.test.ts)

| State | Description | Zod Parse | Tests |
|-------|-------------|-----------|-------|
| 1 | Signal-present, market open | ✅ ACCEPT | 4/4 |
| 2 | No signal, market open + noSetupReason | ✅ ACCEPT | 3/3 |
| 3 | Market closed | ✅ ACCEPT | 3/3 |
| 4 | Full diagnostics present | ✅ ACCEPT | 2/2 |
| 5 | Diagnostics absent (null rejects; undefined accepts) | ✅ ACCEPT | 3/3 |
| 6 | Degraded/stale; `?? []` fallback → REJECT by .length(9) | ✅ ACCEPT/REJECT correct | 3/3 |

---

## Exact Public Status/Reason Matrix (9-Record Contract)

All 9 entries always have `eligibleForEmission: false`. Per `computeAllIndexFnoSetupAvailability()`:

| indexSymbol | setupKey | status | reasonCode |
|-------------|----------|--------|------------|
| NIFTY | VOLUME_BREAKOUT | UNAVAILABLE_REQUIRED_INPUT | INDEX_VOLUME_UNAVAILABLE |
| NIFTY | MEAN_REVERSION | UNAVAILABLE_REQUIRED_INPUT | SESSION_VWAP_UNAVAILABLE |
| NIFTY | TREND_CONTINUATION_NO_VWAP | RETIRED_INDEX_FNO_POLICY | SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY |
| BANKNIFTY | VOLUME_BREAKOUT | UNAVAILABLE_REQUIRED_INPUT | INDEX_VOLUME_UNAVAILABLE |
| BANKNIFTY | MEAN_REVERSION | UNAVAILABLE_REQUIRED_INPUT | SESSION_VWAP_UNAVAILABLE |
| BANKNIFTY | TREND_CONTINUATION_NO_VWAP | RETIRED_INDEX_FNO_POLICY | SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY |
| SENSEX | VOLUME_BREAKOUT | UNAVAILABLE_REQUIRED_INPUT | INDEX_VOLUME_UNAVAILABLE |
| SENSEX | MEAN_REVERSION | UNAVAILABLE_REQUIRED_INPUT | SESSION_VWAP_UNAVAILABLE |
| SENSEX | TREND_CONTINUATION_NO_VWAP | RETIRED_INDEX_FNO_POLICY | SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY |

**Cardinality:** Exactly 9 records always (NIFTY×3 + BANKNIFTY×3 + SENSEX×3). Data-independent invariant. Zod `.length(9)` enforces this at the route boundary.

---

## Spot-Proxy Disposition (pivotRefInventory.a032.test.ts)

- `Ctx.vwap` field: **removed** — does not exist in the Ctx interface.
- `Ctx.pivotRef` field: declared as `number` — holds `authVwap ?? spot` (geometric placeholder, never emitted as VWAP).
- `Ctx.authVwap` field: declared as `number | null` — holds genuine VWAP or null. Only non-null value feeds `signal.vwap`.
- **Signal serialization:** `vwap: c.authVwap != null ? round2(c.authVwap) : undefined` — pivotRef NEVER feeds signal.vwap.
- **pivotRef consumer count:** 4 sites (2 geometry: momentum check + stop calc; 2 connector: confluenceInputs + evaluateDirectionalVetoes `vwap:` arg).
- **Non-fabrication behavioral proof:** zero-volume NIFTY/BANKNIFTY charts produce signals with `signal.vwap === undefined` (not a spot number).

---

## Paper-Admission and C0 Proof

- **C0 killswitch (14 tests):** All pass — `PAPER_TRADING_ENABLED=false` gate is inside `openPaperFoTrade()` before any DB call.
- **Paper-admission A0.3.2 (21 tests):** All 9 entries have `eligibleForEmission: false`; Layer-1 emission gate rejects all 9; Layer-2 C0 gate also rejects when killswitch off; no admission path exists through A0.3 setups.

---

## Schema/Code-Generation Parity (openapiSpecParity.a032.test.ts — reads actual YAML)

| Check | Spec value | Zod value | Match |
|-------|------------|-----------|-------|
| FnoSetupAvailabilityEntry.required includes indexSymbol | ✅ | ✅ | ✅ |
| indexSymbol enum | `[NIFTY, BANKNIFTY, SENSEX]` | `z.enum(["NIFTY","BANKNIFTY","SENSEX"])` | ✅ |
| indexFnoSetupAvailability minItems | 9 | `.length(9)` | ✅ |
| indexFnoSetupAvailability maxItems | 9 | `.length(9)` | ✅ |
| status enum values | ACTIVE, UNAVAILABLE_REQUIRED_INPUT, RETIRED_INDEX_FNO_POLICY | same | ✅ |
| eligibleForEmission | `enum: [false]` | `z.literal(false)` | ✅ |
| scope | INDEX_FNO | `z.literal("INDEX_FNO")` | ✅ |

Evidence SHA256 of openapi.yaml: `796785ecc2bdb48dcbc7ee9f0864df802faaf6cacaf274a1186d0bf8ac45aa00`

---

## Terminator Verification

1. **No `?? []` in IndexFnoSetupAvailabilityStrip (as fallback):** PASS — comment-only references; actual code uses explicit degraded state check.
2. **No `c.vwap` in optionSignals.ts:** PASS — field removed; only `c.pivotRef` and `c.authVwap` exist.
3. **No `computeIndexFnoSetupAvailability(true/false)` in non-test source files:** PASS — only test files use boolean arguments (all updated to string indexSymbol).
4. **`pivotRef` declared in Ctx interface:** PASS — line 230: `pivotRef: number;`.

---

## Evidence File SHA256

| File | SHA256 |
|------|--------|
| optionSignals.ts | `ba59c8d75225e446127e828dee3e7b2b6633f0a81952aa84667aa47acaf29379` |
| optionSignals.setupAvailability.test.ts | `c6f9731d448248209775c39f67ddeb085cddf5a6c7e07459d835b9c5ac11624a` |
| routeSerializer.a032.test.ts | `746243a38319622ce9a0aa42bdc95a6f3c095836eed33f9047df55b079fafeff` |
| openapiSpecParity.a032.test.ts | `7ad1709a408885ee7d008122cd41dbcbb161992c89037e947940abee340fd938` |
| pivotRefInventory.a032.test.ts | `3fd4c390e2dca2918dc725e229b1e874957666a94ff20ad3e1d0b1a8b469d984` |
| paperAdmission.a032.test.ts | `5194beb18ae2ab2eb7da3b9f24675a47f3e0853d283649b27c63236efa3b6196` |
| lib/api-zod/src/generated/api.ts | `ede414584c3e1ebcbaf08fe8f7160a9a2fd312b5558b0ebe63f8c1b88700ddc5` |
| lib/api-spec/openapi.yaml | `796785ecc2bdb48dcbc7ee9f0864df802faaf6cacaf274a1186d0bf8ac45aa00` |

`IMPLEMENTATION_HEAD_BEFORE_EVIDENCE_WRITE`: `f14fc11`  
`WORKTREE_STATE_AT_EVIDENCE_WRITE`: 10 modified/new files, all committed in `ae48a29`

---

## Per-Item Disposition

| Item | Disposition |
|------|-------------|
| D-FAB-06 / VOLUME_BREAKOUT | `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION` |
| D-FAB-07 / MEAN_REVERSION | `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION` |
| no-VWAP TREND_CONTINUATION (TREND_CONTINUATION_NO_VWAP) | `UNIT_VERIFIED_WITH_GOVERNANCE_EXCEPTION` |
| Production | `PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED` |

**Governance exception remaining:** Production verification only. All unit, schema, route-state, and paper-admission proofs are complete.

---

## Unresolved Items

1. **4 pre-existing zeroVolume failures** — Present on HEAD before A0.3.2 (confirmed via `git stash`). Not caused by A0.3.2 changes. Scope: separate task.
2. **Production deployment** — Not published. Manual publish required to verify prod schema propagation via Replit's dev→prod diff mechanism.
3. **Manual push not performed** — All commits on `main` branch, not pushed to remote. Manual `git push` required.

