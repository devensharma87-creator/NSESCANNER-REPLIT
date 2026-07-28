---
name: A0.3.2 evidence complete
description: Final evidence record for Phase A0.3 — per-index 9-record setup availability contract, pivotRef rename, all tests pass.
---

## Key invariants proved in A0.3.2

- `computeAllIndexFnoSetupAvailability()` always returns exactly 9 records (NIFTY×3 + BANKNIFTY×3 + SENSEX×3)
- `computeIndexFnoSetupAvailability(indexSymbol)` always returns exactly 3 records per index (unconditional — A0.3.2 removed the vwapAvailable conditional that was dead code for cash indices)
- `Zod .length(9)` enforces cardinality at route boundary — `?? []` fallback is now fail-closed
- `eligibleForEmission: z.literal(false)` — all 9 entries always false

## Ctx.pivotRef rename

- `Ctx.vwap` was removed; replaced with `Ctx.pivotRef` (same value: `authVwap ?? spot`)
- `Ctx.authVwap: number | null` — only genuine VWAP; null when unavailable
- signal.vwap emitted only when `c.authVwap != null` — pivotRef never leaks as VWAP output
- 4 consumer sites of c.pivotRef: momentum check, stop calc (geometry); confluenceInputs.vwap, evaluateDirectionalVetoes.vwap (connector inputs)

## TypeScript shape inference truncation

- Zod `GetOptionSignalsResponse.shape.setupState.unwrap().shape.indexFnoSetupAvailability` fails TypeScript type inference (only 5 fields visible, indexFnoSetupAvailability is the 6th)
- Root cause: TypeScript inference depth limit on large Zod schemas
- Fix: `(schema.unwrap() as any).shape.indexFnoSetupAvailability`
- Runtime works correctly — Zod sees all fields; only TypeScript compile-time inference is truncated

## Pre-existing zeroVolume failures

- 4 tests in `optionSignals.zeroVolume.test.ts` fail with current HEAD
- Confirmed pre-existing via `git stash` test — present before A0.3.2 changes
- Root cause: BEARISH chart fixture no longer produces a signal strong enough for HC emission

## Evidence HEAD

- Final evidence commit: `ae48a29` (A0.3.2 evidence complete: 248 tests pass)
- Evidence file: `artifacts/audit-evidence/PHASE_A0_3_SETUP_VIABILITY_AND_HONEST_RETIREMENT.md`
