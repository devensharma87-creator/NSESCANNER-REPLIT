---
name: Aggregate LIVE status is not freshness- or coverage-aware
description: Open deployment blocker — deriveQuoteStatus infers LIVE_TICKS from a non-zero quote count, so it can read green while instruments are stale, missing, or under disputed token identity.
---

# AGGREGATE_LIVE_STATUS_NOT_FRESHNESS_OR_COVERAGE_AWARE

`deriveQuoteStatus` derives `LIVE_TICKS` purely from `liveQuotesCount > 0`. It
does **not** prove:

- per-instrument tick freshness (one fresh tick out of hundreds still reads LIVE)
- required-universe coverage (a mostly-empty feed still reads LIVE)
- pending provider-token reconciliation state (a disputed identity still counts
  toward the quote total)

**Why:** this is an owner-recorded deployment blocker, deliberately left unfixed.
Correcting the aggregate badge changes production behaviour — a surface that
currently reads green would start reading degraded — so it exceeds the
"status serialization only" scope that the identity work was authorized under.
It is reserved for its own bounded phase.

**How to apply:** do not treat a green `quoteStatus` / `LIVE_TICKS` badge as
evidence that market data is actually live and complete. Per-instrument truth
lives in `marketData/freshness.ts` (`computeFreshness`, budgets from
`getPolicy()`), never in the aggregate. When the bounded fix is authorized, the
aggregate must consume per-instrument freshness, universe coverage, and
`pendingReconciliationCount` — and the change must be treated as a behaviour
change, not a serialization change.

Related: pending token rotations already expose safe state/count publicly and
full detail on the owner-only feed status, and are never eligible for a LIVE
label while pending. See `canonical-instrument-identity.md`.
