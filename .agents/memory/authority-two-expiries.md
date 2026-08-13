---
name: A generation has two independent expiries
description: Re-evaluating only the trading calendar at boot silently labels an expired BSE reference verdict CURRENT; both clocks must be re-asked at the same boundary.
---

# Restored reference data has TWO expiry clocks, not one

A persisted market-reference generation carries at least two authority claims,
and each stops being true on its own schedule:

1. **Trading calendar** — does the committed calendar still cover today, and is
   the session it reconciled to still the latest completed session?
2. **Source-of-record retrieval** — was the underlying official list retrieved
   within the window the source policy allows (for BSE List of Scrips: the
   CURRENT IST calendar day)?

Re-evaluating (1) at boot and trusting the persisted verdict of (2) produces a
verdict that is wrong in exactly the most dangerous direction: yesterday's
universe reported as `CURRENT_AUTHORITATIVE` today.

**Why:** the two clocks overlap for most of the day. A generation built
yesterday afternoon still names the correct latest completed session all
through today until today's close — so the calendar check passes and nothing
contradicts the stale boolean. The gap is invisible until a boot happens on a
different calendar day from the build, which is precisely the boot that matters.

**How to apply:**
- Any authority that is decided at BUILD time and then serialised is a fact
  about that instant. At restore time it must be re-derived from its own
  inputs at `nowMs`, never read back as a boolean.
- Put both re-evaluations behind ONE current-time boundary that returns the
  weaker verdict, and let every consumer (restoration state, in-memory
  authority, coverage denominator, readiness) read that boundary. A second
  consumer re-implementing one half of the check is how the halves drift apart.
- Cache the combined verdict only until the EARLIER of the two expiry instants.
- Keep integrity and authority separate: an intact-but-expired generation is
  installed as last-known evidence (still served, may not authorize), while
  evidence that cannot be believed at all — missing, unparseable, or dated
  after the generation carrying it — is refused outright.
- Calendar-day boundaries are calendar arithmetic in the exchange's timezone.
  Deriving them from a day-length duration constant invites both a UTC-midnight
  bug and a policy guard failure, since a duration reads as an age threshold.
