---
name: Denominator commitment hashing
description: Why a partial-subset hash can never bind a coverage denominator, and why schema/policy version must be part of a content-derived generation id.
---

# A partial-subset hash cannot bind a denominator

A manifest that hashes only the *interesting* subset of its records does not
protect the denominator computed from the *whole* set.

Concretely: a hash over "LIVE_REQUIRED records that are mapped to a provider
token" leaves every **unmapped** LIVE_REQUIRED record uncommitted. Those records
are the ones that matter most — they are required but unobtainable, so they are
exactly what an honest coverage number must count as missing. Delete or demote
one and the subset hash, the manifest checksum and the tier arithmetic all still
verify, while the denominator silently shrinks and the system upgrades its own
claim to "authoritative".

**Rule:** any artifact that authorizes a completeness claim must carry a
commitment over the ENTIRE record set (including a record count), not over the
subset the feature happens to care about. Include every field a consumer uses to
decide membership: identity, tier, mapping status, provider token, listing
status.

**Why:** found in review during the instrument-registry phase. All the obvious
integrity checks passed; the attack was invisible to every one of them.

**How to apply:** when adding an integrity hash, ask "what can I change without
breaking this?" — then check whether any of those changes alters a number the
system reports as authoritative.

# The authority boundary re-applies every gate

The function that converts stored state into an authoritative claim must
re-verify schema version, policy version and policy hash itself, even when the
loader already did. A caller can construct the input object directly, and a
self-consistent artifact written under a *different* classification policy means
something different from what today's consumers will read it as. Delegating
gates to an upstream loader makes the boundary bypassable by construction.

# Version must be part of a content-derived id

A generation id derived from source content alone deadlocks across a schema or
policy bump:

1. New code computes the same id from the same bytes.
2. The insert hits `ON CONFLICT DO NOTHING` and is skipped — reporting success.
3. The loader then rejects the surviving old row for version mismatch.
4. Result: permanently unconfigured, with a write path that keeps saying `ok`.

**Rule:** fold the schema and policy versions into the identity hash. The same
bytes interpreted under a different policy describe a different universe, so
they deserve a different id.

**Why:** observed only on the second execution of the durable path; a single run
looks perfectly healthy.

    ## Retention is paid for by an actual insert

    Bounded retention inside a write transaction must execute only when the INSERT
    created a row. Running it on the `ON CONFLICT DO NOTHING` path lets a replay of
    an existing generation prune history it did not extend.

    **Why:** the registry writer shipped retention unconditionally after the insert;
    a duplicate re-run therefore trimmed the table while honestly reporting that it
    had committed nothing.

    **How to apply:** return before the DELETE when `RETURNING` yields no row; keep
    the DELETE in the same transaction so a retention failure takes the new row with
    it; give the retained-set ordering a tie-break column so it is deterministic; and
    report the no-op honestly (no snapshot id, no commit time).
