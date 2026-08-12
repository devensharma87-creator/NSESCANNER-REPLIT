---
name: Session times and expiring calendar authority
description: Why regular-session hours must be sourced per exchange, and why an intact calendar commitment must still expire against the clock.
---

## Session hours are per-exchange source material, not a constant

A shared `15:30` close constant makes session identity — and therefore every
authority bound to a completed session — an assertion of this codebase. It also
makes divergence unrepresentable: two exchanges can never differ, even after one
of them changes its hours.

**Why:** the calendar decided session completion against exactly such a shared
constant, and an authority review rejected it. The hours turned out to be
identical, which is the trap: a correct answer from an unsourced input is still
unsourced.

**How to apply:** each exchange carries its OWN timing document with its own
provenance, size limits and reproducible evidence rows. Identical hours across
exchanges are a finding, never an inheritance. Absence fails closed per exchange.
Precedence: exceptional circular > special/Muhurat/half-day circular > regular
timing document > fail closed. HALF_DAY only from an official override, never
inferred from short hours; equal-priority disagreement is AMBIGUOUS, never
resolved in our favour. If a document only anchors some sessions (BSE publishes
no uniquely anchorable pre-open), commit null for the rest — a guessed pre-open
is worse than an absent one.

## Integrity is immutable; authority expires

Verifying a stored commitment and being entitled to act on it are different
questions. Fused into one function, a commitment that is internally perfect stays
"verified" forever, including on a date its sources never covered.

**Why:** an accepted registry generation kept granting a coverage denominator
after its calendar year could no longer speak for today.

**How to apply:** one clock-free integrity function (recompute the checksum over
committed material, re-derive the stored conclusion) and one clock-dependent
authority function returning CURRENT_AUTHORITATIVE / LAST_KNOWN / STALE plus the
instant the answer stops holding. Expiry changes what the system will CLAIM, never
what it stored — never rewrite a stored checksum on expiry. Memoize one entry per
boundary keyed on generation id + validity instant so nothing rescans the record
set per tick.

**Consequence to keep in mind:** where a reference universe is bound to a
completed session (BSE here), the completion of a NEWER session is itself
authority-losing — the registry must be refreshed every trading session, not
merely every calendar year.

## Parsing an exchange's own application bundle

A megabytes-large app bundle is not a page. Two defects came from treating it as
one:

- A whole-body scan for `captcha` rejects a valid source: the bundle legitimately
  contains the word hundreds of times. Interstitial detection belongs in the
  leading few KB, and generic markers should only be trusted when the body is
  small enough to BE a challenge page.
- Label anchors must require the label to START a cell or string literal and be
  singular, or ordinary prose ("…with the continuous trading sessions from 9.00
  a.m…") is read as a published timing. Also remember the bundle is un-evaluated
  source: a dash can arrive as a literal `\u2013` escape whose digits will break a
  naive numeric separator.

    ## Finding the row is not proof of the document

    A parser that accepts as soon as its anchor matches will accept a truncated
    response, or a padded body carrying a copied row, as an authoritative source.

    **Why:** both timing parsers shipped this way and it was caught in review — a
    fragment holding the wanted row would have granted a session close time, which
    decides session completion and therefore every authority bound to it.

    **How to apply:** every source needs a completeness contract of its own shape
    before any value is read: a document-scale size floor, an end-of-document marker
    (closing tag, or a terminated final statement for a bundle), an artefact-identity
    anchor when the body is a generic bundle, and — where the publication has a known
    row set — a requirement that EVERY published row is present, not just the ones
    being read.
    