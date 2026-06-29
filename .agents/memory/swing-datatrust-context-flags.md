---
name: Swing data-trust requires owner-context flags from every candidate builder
description: Why API-staged swing orders silently fail-closed unless the route builder threads benchmarkAvailable/sector into the candidate.
---

# Swing data-trust context flags must be threaded by EVERY candidate builder

The Phase-1 swing data-trust gate (`swingCashDataTrust.ts`) requires certain
**owner-supplied signal-context flags** to be explicitly `true` or it marks the
candidate `reviewRequired` and the risk engine fail-closes
(`allowed = cleanPass && !notReadyNow && !reviewRequired`). The relevant flags are
NOT freshness/source claims — they are context (like `sector`):
- `sectorAvailable`
- `benchmarkAvailable` (gated by `requireBenchmark`, default true)

**Why this bites:** a candidate builder that omits one of these makes it `undefined`,
which the gate treats as missing → `REVIEW_REQUIRED` → approval permanently
`RECHECK_BLOCKED`. The service-layer happy-path tests set these flags directly, so
the failure only appears at a real entry point (the `/swing/*` route's
`buildSnapshotCandidate`) that forgot to thread it. This is the same class of bug as
"signal-gate-reconcile-coupling" — a fail-closed gate field that a second code path
doesn't populate.

**How to apply:** any NEW swing candidate builder / staging entry point (Phase 3,
alternate routes, reconcile/backfill) MUST thread every data-trust context flag the
gate requires. Pattern: `benchmarkAvailable: input.benchmarkAvailable === true ? true : undefined`
— only an explicit owner `true` counts; omitted/false stays fail-closed; never
fabricate the flag server-side. These are CONTEXT, not freshness — keep ltp / ohlc /
dataSource / asOf server-stamped.
