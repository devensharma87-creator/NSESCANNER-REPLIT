---
name: Pack 33C Phase 0.8B canonical record + activation boundary
description: What was fixed and what to watch in the feed activation boundary + canonical quote record layer.
---

## What was completed

Three gaps in the Phase 0.8B feed foundation were closed:

1. **Canonical quote record** — `LiveTick` now carries 14 provenance fields
   (exchangeTimestamp, receivedTimestamp, registryGenerationId, shardId,
   subscriptionSetHash, completeManifestHash, validationStatus, freshnessState,
   conflictStatus, lastValidTimestamp, isin, securityId, securityClass,
   providerExchangeToken).

2. **Structured activation decision** — `FeedActivationDecision.gatesPass` replaced
   by `StructuredActivationDecision` with 15 named `FeedActivationGate` objects.
   `REQUIRED_ACTIVATION_GATE_IDS` (15 entries) is the authoritative list.
   `start()` re-derives `allPassed` from gates + cross-validates generationId and
   completeManifestHash against the plan inside the mutex.

3. **Test-only factory isolation** — `_forTesting_authorizeActivation` removed from
   `FeedManagerOptions`. Production gate: `createFeedManager`. Test gate:
   `createFeedManagerForTesting` (asserted to have zero production callers by G32).

## Key design facts

- `ts` on `LiveTick` is a backward-compat alias: `exchangeTimestamp?.getTime() ?? receivedTimestamp`.
  Never fabricated — if provider did not supply exchangeTimestamp, `exchangeTimestamp` is null.
- `validationStatus: "ACCEPTED"` for canonical writes; `"LEGACY_UNVALIDATED"` for kiteFeed.ts SSE writes.
- `freshnessState: "NOT_EVALUATED"` and `conflictStatus: "NOT_EVALUATED"` — Phase 0.8B honesty.
- `lastValidTimestamp`: null on first write; previous `receivedTimestamp` on subsequent writes.
- `kiteFeedClientAdapter.ts` now exports both `createKiteFeedClientAdapter` (direct FeedClientFactory)
  and `createKiteFeedClientFactory(getCredentials?, nowMs?, timeout?)` (old test-compat API).
  `getCredentials` returning null is caught BEFORE the dynamic SDK import, returning
  `PROVIDER_CREDENTIALS_UNAVAILABLE` without loading kiteconnect.

## Safety locks (all false — do not touch)

- `FEED_RUNTIME_ACTIVATION_AUTHORIZED = false` in feedManager.ts
- `FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED` in candleEvaluationControl.ts
- `SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED` in candleEvaluationControl.ts
- `FNO_PAPER_V2_RUNTIME_AUTHORIZED` in v2PaperLocks.ts
- `SWING_PAPER_V2_RUNTIME_AUTHORIZED` in v2PaperLocks.ts

## Test counts after this session

- p08b tests: 160/160 (9 files: tickIdentity, adapterConnect, activationCapacity,
  startupRollback, reconnect, shutdownDiagnostics, **canonicalRecord** [G1–G13],
  **activationBoundary** [G14–G32])
- p05a tests: 62/62 (UpsertQuoteInput.ts → receivedTimestamp: all callers updated)
- TSC: clean across all 4 packages

## Callers updated for UpsertQuoteInput.ts rename

`ts:` → `receivedTimestamp:` updated in:
- `kiteFeed.ts`
- `canonicalIdentity.p05a.test.ts`
- `indexAliasCanonical.p05a.test.ts`
- `providerTokenReconciliation.p05a.test.ts`
- `tokenReconciliationDiagnostics.p05a.test.ts`
- All p08b.*.test.ts tick construction helpers
