---
name: Feed activation boundary and canonical tick provenance
description: Why the final side-effect boundary must re-derive gates itself, and why a stored tick needs two distinct clocks plus its own provenance.
---

## A summary boolean at a side-effect boundary is not a gate

An activation decision that carries `gatesPass: boolean` moves the decision OUT of
the boundary that acts on it. The boundary then enforces nothing — it obeys.

**Rule:** the function that constructs clients / opens sockets must re-derive the
verdict from individually named gate records, iterating an authoritative required-id
list it owns. A gate absent from the supplied array is `NOT_EVALUATED`, and
`NOT_EVALUATED` counts as FAIL — never as "probably fine".

**Why:** a caller that computes the summary can be wrong, stale, or foreign. Only
recomputation at the boundary binds the refusal to the act.

**How to apply:** any new activation/admission gate set. Order at the boundary:
compile-time lock → cross-validate the decision's identity bindings against the plan
object actually passed in → re-derive every gate → re-prove the plan from its own
contents → only then act. Each step returns early.

## A self-consistent decision can still be a foreign decision

Gate values that all say PASS prove nothing about *which* plan they were computed for.
Cross-check the decision's generation id and manifest hash against the plan object
actually handed to the executor, independently of the gate array, inside the same
mutex that performs the action. Otherwise a decision built for generation A authorises
work on generation B.

## Test bypasses must be a separate factory, not an option

A bypass expressed as an option field (`_forTesting_*`) is reachable by any caller and
by anything that can shape an options object from config or request data. Express it as
a separately named factory function that is unmistakably test-only, and assert zero
production callers with a repo-wide source scan test. The production factory keeps the
compile-time refusal; the test factory bypasses ONLY that constant and still validates
every gate.

## A stored tick has two clocks, and they are not interchangeable

`exchangeTimestamp` (provider-supplied, **null when absent**) and `receivedTimestamp`
(local receipt, always present) answer different questions. Substituting receipt time
for a missing exchange time manufactures an authority claim the provider never made,
and it is undetectable downstream because the record looks well-formed.

**Also:** absent optional fields stay absent — `volume: 0` ("nothing traded") and
`volume: undefined` ("not reported") are different claims. A present-but-unusable field
rejects the whole tick rather than being dropped, because dropping it fabricates the
absent case.

## Status fields must report what was actually evaluated

When freshness or conflict were never computed, the honest value is `NOT_EVALUATED`.
Defaulting conflict to `NO_CONFLICT` implies a cross-provider validation that did not
happen. Likewise a write that bypassed the validation chain gets its own status
(`LEGACY_UNVALIDATED`) rather than being silently upgraded to look validated.

`lastValidTimestamp` must advance only on a newly ACCEPTED value — so every reject path
returns before the store write.

## Identity is resolved from the token, never the symbol

Storage identity comes from resolving the provider token through the canonical registry.
Symbol matching is prohibited: a symbol exists on both NSE and BSE, so a collision does
not error — it writes one exchange's price under another exchange's key. Ambiguous
symbol lookups must surface ambiguity or fall back to the exchange-qualified id; they
must never pick one.

## Adapter SDK imports belong inside connect()

A top-level provider-SDK import executes the SDK module body for every process that
transitively imports the adapter — including test runs and boots that have explicitly
decided not to have a feed. Use a dynamic `import()` inside `connect()`, and validate
credentials *before* it so a missing-credential environment refuses without any provider
side effect.
