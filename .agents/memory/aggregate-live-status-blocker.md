---
name: Deprecated LIVE_TICKS serialization requires removal
description: Open owner-recorded deployment blocker — the deprecated aggregate LIVE badge can read green while instruments are stale or missing. It grants no authority; the trust decision is made by coverage elsewhere.
---

# DEPRECATED_LIVE_TICKS_SERIALIZATION_REQUIRES_REMOVAL

Superseded label (do not reuse): `AGGREGATE_LIVE_STATUS_NOT_FRESHNESS_OR_COVERAGE_AWARE`.
That name overstated the issue: it read as an unfixed authority hole, which it is not.

**The rule.** A green aggregate `LIVE_TICKS` / `quoteStatus` badge is not evidence
that market data is live and complete. It is derived from "some live quotes
exist", which proves nothing about per-instrument freshness, coverage of the
required universe, or unresolved provider-identity disputes. Per-instrument
truth is the only truth; the aggregate is presentation.

**No authority depends on it.** Every trade-grade / complete-status decision
requires a coverage gate in addition to the live flag, so the live flag alone is
necessary-but-insufficient. Re-verify that property before assuming it still
holds, rather than trusting this note.

**Why it stays open.** Owner-recorded and deliberately unfixed: correcting the
badge changes production behaviour (a surface that reads green would start
reading degraded), which exceeds the serialization-only scope the identity work
was authorized under. It is reserved for its own bounded phase.

**How to apply.** Describe the defect as deprecated serialization, never as an
unfixed aggregate-authority implementation. When the bounded fix is authorized,
the aggregate must consume per-instrument freshness, universe coverage and
pending-reconciliation state — and it must be reviewed as a behaviour change.

Related: pending token rotations expose safe state/count publicly and are never
eligible for a LIVE label while pending. See `canonical-instrument-identity.md`.
