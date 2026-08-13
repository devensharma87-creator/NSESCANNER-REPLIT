---
name: An admission boundary must re-apply the FULL commit gate set
description: Why a downstream authority boundary that re-derives "most" integrity gates is fail-open, and which commitments must be re-derived rather than read.
---

**The rule.** A module that decides whether a stored artefact may act (subscribe,
trade, publish) must re-derive *every* gate the write-side commit gate applied —
not a plausible subset. Re-deriving the payload checksum and the whole-set hash
is not enough: any *other* commitment stored in the artefact (a subset hash, a
count floor, an owning-generation id on each row) is just a field until it is
recomputed from the payload in front of you.

**Why.** A hand-built or tampered artefact can carry a self-consistent checksum,
because the checksum is computed over whatever the attacker wrote. The gates
that survive that are the ones re-derived from the records — so a boundary that
re-checks four of seven commitments authorizes the other three by omission. This
was caught in review, not by tests: the tests exercised the gates that existed.

**How to apply.** When writing an authority boundary against a persisted
generation, open the write-side validator and enumerate its gates one by one,
then assert each is present at the read side. Treat these as distinct gates:
payload checksum, schema/policy version, policy hash, whole-record-set hash,
every *subset* commitment hash, record count vs declared totals, per-record
owning-generation id, and the durability floor. Then, and only then, ask the
authority-at-now question.
