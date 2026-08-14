---
name: Evidence envelope source binding
description: Why a typed activation-evidence envelope is fail-open unless gate identity pins the permitted source kind, and the three ways precision work reopened a boundary.
---

# A typed evidence envelope is fail-open until gate identity pins the source

When an admission boundary replaces booleans with typed evidence envelopes
(`state`, `evaluatedAt`, `validUntil`, `sourceKind`, `sourceIdentity`), the
generation/scope binding is applied conditionally — "if this source kind is
generation-scoped, require the identity to match." That conditional is the
hole: the producer chooses the source kind, so a producer can label a
generation-scoped fact as a compile-time constant with a null identity and the
binding silently does not apply. The gate still reads PASS.

**Rule:** pin exactly ONE permitted source kind per gate id, in a map the
judge consults *before* the scope check. A list of permitted alternatives is a
place for a future bypass to hide.

**Why:** found by review in an activation-readiness boundary where 10 of 15
gates were generation-scoped. Every generation check in the system was
bypassable by a one-word change at the producer, and no test caught it because
the test fixtures themselves used the permissive kind.

**How to apply:** whenever evidence carries a self-declared provenance field
that gates a later check. Assert the count of scope-bound gates in a test, so
a future "refactor" that unbinds one has to say so out loud.

## Fixtures that opt out of the check they exist to protect

The fixtures emitted the permissive source kind for every gate, so the whole
prior-phase suite would still have passed had the generation check been
deleted outright. Derive fixture provenance from the same policy map the
production code uses, and bind fixtures to the real generation id — never
hard-code the loosest legal value "because it's just a fixture."

## Three recurring reopenings when making a refusal more precise

1. **Two copies of the rules.** Extracting a validator while leaving the
   original inline gives two implementations that drift; the weaker one ends up
   guarding the side effect. Move the contract into the new module and have the
   caller depend on it one-way.
2. **Optional envelope fields.** An optional field lets "did not decide" read as
   "decided yes." Make every field required; the fixture churn is the point.
3. **The second construction site.** A start path gets the new gate; the
   *reconnect/replacement* path keeps the admission granted at start. The longer
   the process runs, the staler the evidence a new socket rests on — the exact
   inversion of a freshness boundary. Re-derive at EVERY construction site.

## Diagnostics: report all blockers, never the first

An aggregate judge that returns on the first structural problem makes an
operator diagnose by round trip, and repeated single-blocker responses read as
flakiness rather than as several independent refusals. Collect every malformed
/duplicate entry AND still judge every required gate.
