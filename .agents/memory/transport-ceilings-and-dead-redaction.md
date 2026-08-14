---
name: Transport ceilings, run scope, and dead redaction wrappers
description: Four lessons from bounded external retrieval with redirects, per-run budgets, and diagnostic redaction that never reached the wire.
---

## A redirect hop is a transport request

A ceiling expressed in "logical calls per source" is not a ceiling. Each hop is
a separate connection to a separate URL and must be charged **before** it is
issued, not after the response returns.

**Why:** an early bounded-retrieval run declared 12 requests and made 13 — the
three extra were redirect hops nobody had counted, so the disclosed deviation
was found only by hooking the transport layer.

**How to apply:** budget hops, validate every hop target (scheme, host,
credentials-in-URL, loop), cap hops per document, and cancel redirect bodies.
Report planned vs actual **by source and by hop kind**, never a single total.

## Run scope is not construction scope

A reusable service must reset anything scoped to "an attempt" at the START of
the attempt, not when the object is built.

**Why:** a transport budget allocated in the composition factory let a failed
attempt spend the authorized retry's allowance, and merged two runs into one
evidence ledger — so the ceiling and the ledger both stopped meaning what they
claimed.

**How to apply:** give the orchestrator an optional run-lifecycle port called as
the first statement of the run, before any port can issue a request; the
composition swaps in a fresh budget object. Hold it in a `let` the closures read
at call time — do not mutate/reset a spent budget in place.

## A redaction helper wired only into new wrapper functions is dead code

Adding `xRedacted()` next to `x()` protects nothing while every real serializer
still calls `x()`.

**Why:** a structured redactor shipped with passing tests, yet the owner feed
status and readiness report continued emitting raw diagnostics; a later sweep
found a second unredacted route the first sweep had missed.

**How to apply:** wire the redactor at the *existing* serialization boundary and
then grep for every remaining caller of the raw getter in route/response files.
The fix is not done until the raw function has no serializer callers.

Corollary: **substring redaction destroys safe domain fields.** A `/token/i`
blanket rule wipes `tokenReconciliation` and `requiredTokenCount`, which are
instrument-token *counts*, not credentials. Use explicit key-aware allow/deny
tables, and where a test allowlists a credential-shaped NAME, make it also
assert the VALUE's shape — otherwise the allowlist quietly excuses real leaks.

## `Error.name` is source-influenced

`name` is a writable string a library or parser can set from response text.
Interpolating it into a reason code exports arbitrary source material into logs.
Map it through a fixed vocabulary and emit one constant for anything else.

## Fixing the first blocker unmasks the next

A pipeline that always refuses at step N has never executed step N+1, so every
defect after it is untested. Expect the first successful pass of a long-blocked
stage to fail somewhere new, and treat that as progress, not regression.
