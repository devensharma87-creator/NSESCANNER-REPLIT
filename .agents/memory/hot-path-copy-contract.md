---
name: Hot-path copy = an explicit type contract, never a generic clone
description: Why a "copy what you can, share and count the rest" helper is not an isolation guarantee, and what a defensible replay/snapshot copy looks like.
---

# Retaining caller data on a hot path

## The rule

When a hot path RETAINS caller-supplied data (replay ring, audit buffer,
snapshot store), the copy must be an **explicit, finite, type-specific
contract with exactly two outcomes**: copy a supported value, or reject
the entry fail-closed. There is no third "share this one and increment a
counter" outcome.

**Why:** a counter records that an entry *might* be corruptible; it does
not prevent the corruption. Diagnostics are not an invariant. An owner
review rejected a generic bounded copier on exactly this ground — it
copied what `JSON.stringify` could observe and shared class instances,
`toJSON`-bearing objects, and containers past a depth limit, counting
each. "Observable in production" is not the same as "cannot happen."

**How to apply:** inventory the real runtime shapes at every push site
FIRST (read the call sites; do not infer from the TypeScript types —
they are usually wider than reality). If nothing reachable emits the
exotic types, a strict contract costs nothing and you can reject them
outright instead of inventing an unauthorized normalization (ISO vs
epoch for a Date is a product decision, not a copy decision).

## Never read caller data with plain member access

If the contract promises "no caller code runs," then **every** field
read must go through `Object.getOwnPropertyDescriptor` — including
top-level fields and even `array.length`. A single `obj.field` read
executes a getter and breaks the guarantee. Two traps that are easy to
miss:

- A **non-enumerable `toJSON`** still drives `JSON.stringify` while never
  appearing in `Object.keys`. Check it by descriptor, explicitly.
- `i in arr` is true for indices inherited from a polluted
  `Array.prototype`, but `getOwnPropertyDescriptor` returns `undefined`
  for them — so `getOwnPropertyDescriptor(arr, i)!` crashes. Distinguish
  a genuine hole from an inherited index and reject the latter.

Also: `Array.isArray` returns true for Array **subclasses**; only the
prototype tells you it is really a plain array. Detect Promises with
`instanceof`, never by reading `.then` (that read fires a getter).

**Proxies are the honest boundary.** `getOwnPropertyDescriptor`,
`ownKeys`, `getPrototypeOf` and `in` all fire proxy traps, and a proxy
cannot be identified without firing one. Document that limit rather than
claiming to cover it — and prove the property that still holds
absolutely: a throwing trap aborts before anything is stored, so a
hostile value costs an entry, never integrity. (Bonus: descriptor-only
reads never fire `get` traps at all, so that whole proxy class is
normalized into ordinary data.)

## Cost

Descriptor-driven copying is roughly **10x the cost of storing a bare
reference**, but that ratio is against an almost-free baseline — on the
real payload it measured ~900 ns vs ~100 ns per entry, which is
negligible at market tick rates. Benchmark the **actual** production
payload shape, not a synthetic worst case: a padded synthetic object
overstated the same contract's cost by ~7x.

**Guard your benchmark:** a fail-closed path that rejects everything
looks blazingly fast. Assert the timed loop actually stored what it
claims and recorded zero rejections, or the number is a lie.
