---
name: Aggregate market-data coverage contract
description: How truthful aggregate LIVE status is derived — two denominators, fail-closed completeness, and the traps that make a partial feed look complete.
---

# Truthful aggregate coverage

A non-zero live-quote count is never evidence of coverage. Any aggregate
"live/complete/trade-grade" claim must be derived from per-instrument
freshness against an explicit denominator, never from a count being > 0.

**Why:** the original deriver returned `LIVE_TICKS` whenever `liveQuotesCount > 0`,
which fed a green "Kite live" chip and a `TRADE_GRADE_LIVE` global status. A
single stale tick from one instrument could present as whole-market live data.

## Two denominators, always reported side by side

- **configured** — whatever the legacy feed happens to subscribe to. Authority
  `LEGACY_PARTIAL_CONFIGURATION`.
- **authoritative** — the approved reconciled universe. Currently
  `UNIVERSE_NOT_CONFIGURED`; do not fabricate one.

Completeness is gated on the *authoritative* denominator, so the configured
feed can never reach a "complete" state no matter how internally consistent it
is. Today this correctly yields `LIVE_PARTIAL` + blocker
`AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED`.

## Traps that a review caught, worth re-checking on any change

1. **Never inherit the authoritative counts from the configured counts.** If
   the authoritative numerator is just aliased to the configured one, flipping
   the authority enum instantly turns a small feed into "full market coverage".
   Compute it independently from the authoritative required-id set.
2. **An authority enum value proves nothing on its own.** Also require valid
   reconciliation metadata, a non-null generation id, and a non-empty required
   set.
3. **Validate the observation set's identity integrity.** Duplicated ids can
   fill the quota left by a missing instrument, making counts arithmetically
   perfect and factually false. Foreign ids (outside the required set) do the
   same. Both must fail closed.
4. **Liveness requires a connected socket, not a running supervisor.** A feed
   process can be "running" with the socket down; recent cached ticks would
   then satisfy every freshness check over a dead connection.
5. **A closed market does not neutralise an integrity fault.** A green
   "session active — market closed" badge is a claim about the session, but
   conflicted quotes and unresolved token rotations must still downgrade it.

## Pending reconciliation is an overlay, and it cross-cuts buckets

A pending instrument occupies exactly one partition bucket: `unavailable`
normally, but `conflicted` when it is also conflicted (conflict is more severe
and wins). So "pending" does NOT imply "counted in unavailable". The pending
count is excluded from the partition equation precisely because it cross-cuts.

**How to apply:** if you assert `pending ⊆ unavailable` anywhere, it is wrong.

## Known open gap — verified session close

The live quote store holds last *traded* ticks, not a verified canonical
official close, and Kite's `ohlc.close` is not the current session's close. The
live builder therefore always sets `sessionCloseVerified: false`, so after
market close everything degrades honestly to `LAST_KNOWN` and
`MARKET_CLOSED_FINAL` is never asserted in production. The contract supports
the distinction; the data source does not. Do not paper over this by treating
a last traded tick as a close.

## "Not conflicted" means unmeasured

No cross-provider comparison runs on this path, so the conflicted set is always
empty. That is *unmeasured*, never *verified-agreeing*.
