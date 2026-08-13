---
name: Exchange qualification belongs at the source, not the call site
description: How NSE-defaulting was eliminated — declare the exchange once where it is established, thread it, and fail closed elsewhere; plus the residual DB-level default that still defaults silently.
---

## Rule

An exchange is never supplied by the consumer as a literal and never defaulted.
It is declared **once, at the source that actually establishes it**, exported as
a named constant, and threaded from there:

- a curated symbol table is NSE *by construction* → the table exports the constant;
- an eligibility classifier that compares against an exchange exports the same
  constant the gate uses, so the gate and its callers cannot disagree;
- a quote loader that builds `NSE:<sym>` keys uses one constant for **both** the
  key and the `exchange` field it stamps, so key and label cannot drift apart.

Everywhere else the exchange must arrive as data. Resolution order:
valid canonical id → exact provider token → exact exchange + exact symbol →
explicit blocker. Never first-search-hit, never fuzzy/ISIN dedupe across NSE/BSE.

**Why:** the same trading symbol lists on both NSE and BSE. A `?? "NSE"` on a
missing field silently invents an identity, and downstream everything (cache
keys, paper positions, CSV exports, UI labels) inherits it as if it were fact.

## How to apply

- **Untrusted boundaries validate and drop, they do not coerce.** DB rows and
  entries handed in by other modules get normalised through a closed-set
  function; unqualified ones are skipped and *counted/logged*, never repaired.
- **Typed closed-set parameters** (`"NSE" | "BSE"`, required) make an unqualified
  call fail at compile time — cheaper than any runtime guard.
- **A fail-closed identity gate belongs inside the writer**, as one of its first
  statements before any DB access — not in one caller. Writers reached from an
  auto tick, a manual route and a staged-approval path will otherwise be entered
  through the ungated door. (Same lesson as the C0 kill-switch placement.)
- **A price's exchange beats a recorded holding's exchange.** If the quote
  endpoint priced the NSE listing, the row is NSE even when the holding was
  recorded on BSE — reporting the recorded exchange would attribute one
  listing's price to another. Unknown still stays `null`.
- Display/provenance-only surfaces may report `null` rather than a blocker code;
  anything that opens a position or keys a cache must fail closed.

## The four ways a gate is still bypassable

1. **A DDL column default** (`exchange TEXT NOT NULL DEFAULT 'NSE'`) defeats
   every code guard: a writer that omits the column produces a row that *looks*
   qualified, so restore-time validation cannot detect, count or reject it.
   Removing it is a schema change — the dev database is the only place to apply
   it, and production follows through the platform's publish diff, never a
   script. Data is never relabelled: a stored `NSE` records no provenance, so
   whether it was written explicitly or defaulted is **unrecoverable**, and
   guessing is worse than the honest `PROVENANCE_UNVERIFIABLE` classification.
2. **A caller that fabricates the value the gate checks.** A writer gate that
   validates `exchange: "NSE"` handed in by its own caller is unfalsifiable —
   it can never reject anything. Every lane (auto, manual, staged) must source
   the exchange from data that established it, and refuse when it is absent.
3. **Validating one value and persisting another.** Bind the *normalised* result
   in the INSERT, not the raw field: `" nse "` passes the gate and would
   otherwise store a second representation of the same order book.
4. **The ORM schema declaration behind the runtime DDL.** Dropping a default
   from a runtime `CREATE TABLE` is undone by the deploy-time schema diff if the
   same column still carries `.default(...)` in the ORM schema. Runtime-created
   tables are declared there (to stop the diff proposing a DROP), so a DDL
   change is only real once both copies agree.
5. **An identity resolver with a preference default.** `opts.exchange ?? "NSE"`
   is the same fabrication one layer up. A dual-listed symbol asked for without
   an exchange must return an explicit *ambiguous* outcome carrying both
   exchange-qualified candidates — not the first hit, and not the NSE one.
   An unrecognised preference value fails closed; it does not fall back.
   Candidate ordering must sort on identity (exchange, symbol, token) so the
   answer cannot depend on master-file row order.
