---
name: Hot-path defensive copy — serialization contract, not structured clone
description: Why a bounded "copy what the consumer can serialize" copy beats a general structured clone on a per-tick path, and the three exclusions that must stay counted.
---

When a buffer must stop consumer mutation from corrupting retained storage,
copy **exactly what the sole consumer can observe**, not "everything".

If the only consumer serializes to JSON/JSONL, the authoritative definition of
an entry's shape is what `JSON.stringify` observes: own, enumerable,
string-keyed properties, with getters evaluated. Reproduce that set and the
output is provably byte-identical, while staying on V8's fast property path.

**Why:** two general-purpose designs were tried and both failed measurably.

1. Reference-sharing (no copy) — a caller reusing one object across pushes
   retroactively rewrote earlier entries. Reachable with ordinary data.
2. Full descriptor preservation (`Reflect.ownKeys` + `getOwnPropertyDescriptor`
   + `defineProperty`) — cost ~23.4us/tick, a ~10x throughput regression,
   because per-property descriptor objects and `defineProperty` leave the fast
   path. It *also* failed correctness: transplanting an accessor keeps the
   getter's closure shared, so a consumer still reaches retained state.
   Evaluating getters once at insertion is both faster and strictly safer.

**How to apply:**
- Copy at BOTH insertion and read. Insertion alone loses to a caller mutating
  or reusing its object after push; read alone loses to consumer mutation.
- `Object.keys` + plain assignment, but never `out[k] = v` for `k ===
  "__proto__"` — that invokes the inherited setter, drops the key and mutates
  the copy's prototype. `JSON.parse` can produce an own `__proto__` key, so
  anything sourced from an HTTP payload can carry one. Use `defineProperty`.
- Check for a **custom** `toJSON` before any Date/Map/Set branch, since those
  branches build a new instance that would silently drop it. Exclude
  `Date.prototype.toJSON`, which every Date has and a copied Date reproduces.
- Copy `Date` before the depth check: it is O(1) and terminal, and a shared
  `Date` is mutable via `setTime`.
- Depth-limit the recursion. Unbounded cloning on an append path reintroduces
  the unbounded per-append work the ring buffer existed to remove, and the
  limit also makes reference cycles terminate for free.

**The exclusions must be counted, not asserted absent.** Class instances,
`toJSON`-bearing objects, and containers past the depth limit stay shared.
Expose a counter for each and surface it on the existing stats endpoint. A
counter turns "this never happens" from an assumption into a measurement, and
is the difference between bounded isolation and hand-waving. Verify
reachability by inspecting *every* call site rather than reasoning about the
type — the declared type is usually far wider than what callers actually pass.
