---
name: Exchange trading-calendar authority
description: How session identity (latest completed trading session) is established from official NSE/BSE documents, and the two ways a "commitment" to it can be fake.
---

## A checksum a reader cannot recompute is not a commitment

If a durable record carries a checksum, a derived id and a conclusion — but not
the material the checksum was computed over — then verification can only confirm
that the id derives from an *asserted* checksum. Nothing binds it to reality. A
fabricated record pairing a plausible conclusion with a self-consistent
id/checksum pair passes every check, at every boundary, forever.

**Why:** this shipped in the trading-calendar commitment and was caught in
review. The reasoning that produced it was circular — "the outer manifest
checksum already covers the commitment" is true and irrelevant, because the
outer checksum covers whatever the commitment *says*.

**How to apply:** embed enough canonical material to recompute the checksum
through the same function the builder uses, and re-derive the conclusion from
that material rather than reading the stored conclusion. Size is a weak argument
against this; ~730 session rows next to ~9,700 instrument records is noise.
Note that a conclusion which is NOT part of the checksum (an evaluation result
like "latest completed session") can only be caught by re-derivation — checksum
agreement says nothing about it.

## A minimum-row floor is not a truncation defence

Accepting a parsed table once N rows are present means a valid N-row prefix
followed by bot-block, error or truncated content parses as authoritative, with
every later row silently absent. For an exchange holiday table that turns real
holidays into ordinary trading days.

**How to apply:** require an explicit table terminator (the next section's
caption) so a truncated document is rejected rather than half-read, and after
the row loop require that no row-shaped cell remains unconsumed — otherwise a
single inserted or missing cell reads as "end of table" instead of lost
alignment.

## Session-identity rules worth keeping

- Completion is decided by the official close instant in IST, never by an age
  threshold. Any "hours since" test on session identity is a bug.
- A declared session whose timings have not been officially notified must fail
  closed, never be skipped: skipping it nominates an OLDER session as latest,
  which is silent and plausible.
- Enumerate every covered day rather than storing overrides only, so no consumer
  reconstructs the default and the checksum covers every session.
- Weekday-only trading-day helpers cannot answer session identity — they see
  neither a weekday holiday nor a Sunday Muhurat session.
- Calendar authority establishes session identity ONLY. It never implies a
  subscription and never makes a quote LIVE.

## Source retrieval reality (Indian exchanges)

NSE's holiday-master API needs a cookie warm-up. BSE's holiday JSON API is
bot-blocked and redirects to an error page; the published Trading Holidays table
must be read from the page bundle BSE itself serves, anchored on the published
equity-segment caption so the currency-derivatives table below it can never be
read by mistake. NSE lists weekend holidays that BSE omits — the effective set of
closed days is identical, so treat that difference as presentational, and version
the two calendars separately.

## Session times and expiry

See [session-time-authority-expiry.md](session-time-authority-expiry.md) — regular
hours must be sourced per exchange, and an intact commitment must still expire
against the clock.
