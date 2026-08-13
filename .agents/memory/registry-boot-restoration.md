---
name: Registry boot restoration contract
description: Rules for restoring a durable authoritative registry generation at process start — read-only, fail-closed, settled-vs-empty, and refusal revoking earlier state.
---

## The rules

1. **A restore path that issues DDL is a writer.** `CREATE TABLE IF NOT EXISTS` /
   `CREATE INDEX IF NOT EXISTS` inside a loader makes "read-only boot" untrue.
   Probe existence read-only instead (`SELECT to_regclass('public.<table>')`,
   which returns NULL rather than raising) and report an absent table as a
   terminal `NOT_CONFIGURED`. The writer path keeps its own schema-ensure.

2. **An outage is not "nothing there".** When the authoritative durable store is
   unreachable, do NOT fall through to a lower cache tier (disk/L1) — that tier
   may hold any older generation, and installing it reports a healthy restore
   over an unanswered question. Fail closed with a distinct
   `DATABASE_UNAVAILABLE`. A lower tier is only legitimate when the store
   *answered* and had nothing compatible.

3. **A refusal must revoke what an earlier restoration installed.** Fail closed
   against yourself: if this attempt cannot vouch for the store, clear the
   in-memory slot and any authority memo, or a corrupt second attempt leaves the
   first generation quietly claimable.

4. **"Not restored yet" and "restored and found nothing" are different facts.**
   Consumers must read the registry through a *settled* accessor that returns
   null until restoration reaches a terminal state; otherwise a request racing
   boot sees an empty universe it can mistake for a complete one.

5. **Integrity before authority, and never merged.** Integrity is a property of
   the stored bytes at the instant they were committed (checksum, record-set
   hash, record count, embedded calendar commitment) and must be re-verified
   before anything is installed. Authority is a property of *now* and is
   re-evaluated at the actual boot instant. An intact-but-expired generation is
   installed as last-known and may not authorize; an unverifiable commitment is
   not installed at all.

6. **Await restoration before the listener opens.** Sequencing is the cheapest
   correct fix — no sleeps, no polling, no readiness scheduler. Keep it
   non-fatal: a refusal degrades coverage, it does not stop the server.

**Why:** each of these was a real hole in the same loader — DDL on the read
path, disk masking a DB outage, a refusal leaving stale memory claimable, and
consumers able to run before restoration settled.

**How to apply:** any "restore durable state at boot" work — registry, calendar,
universe snapshots — re-checks all six before claiming the path is read-only or
fail-closed.

## Gate-order trap when writing tests

Tampering fixtures reach the gate you expect only if the earlier gates still
pass. Rebuilding a manifest around tampered contents usually yields a REJECTED
manifest (a different refusal); editing a field without recomputing the manifest
checksum trips the checksum gate first. To exercise a later gate, patch the
field and recompute the manifest checksum over the patched body. Truncating or
duplicating records trips the eligible-live-set hash before the record-set hash
and before the arithmetic count gate.
