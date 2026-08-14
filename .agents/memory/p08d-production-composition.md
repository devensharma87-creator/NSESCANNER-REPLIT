---
name: Production composition binding accepted ports
description: Lessons from binding an accepted orchestrator's abstract ports to real providers while the operation stays authorization-disabled.
---

## A transitive static import defeats an SDK-confinement guard

A guard that scans each file in a directory for `from "kiteconnect"` proves
nothing about whether importing that directory loads the SDK. A module can
import a *sibling* that statically imports the SDK and pass the guard while
still pulling the broker client into the process at load time.

**Why:** the whole point of confining a provider SDK to a named adapter is that
loading unrelated modules must not construct provider clients or require
credentials. A one-file regex measures spelling, not the import graph.

**How to apply:** guard by walking the transitive **static** import graph from
the module under test (follow relative specifiers, treat bare specifiers as
leaves) and assert the SDK appears nowhere in it. Dynamic `import()` inside a
function is intentionally invisible to that walk — that is the permitted form.
When the SDK-owning module also owns a cheap env *presence* probe, re-derive the
probe locally rather than importing the module for it; a presence boolean is not
policy, but the import is a boot-time SDK load.

## Identity binding and lazy loading are not in conflict

Binding deps by object identity (`deps.f === acceptedF`) is how you prove the
composition points at the accepted function rather than a look-alike. That
appears to force a static import. It does not: make the dep a **module loader**
(`() => import("../mod")`) and let the test `await` it and compare the resolved
export. Identity stays provable; the production module stays SDK-free.

## A production module must hold no reference to an authorization bypass

Naming a factory `__TEST_ONLY_createAuthorizedProductionX` and asserting it has
no production callers is weaker than not having it. Export the **port builder**
from production and let the *test file* hand those real ports to the
orchestrator's own test-only authorized factory.

**Why:** "no production caller today" is a fact about the current tree; "the
symbol does not exist in production" is an invariant. It also shrinks the
production surface and lets the guard stay strict instead of being widened.

**How to apply:** when a guard flags your new module for referencing a bypass,
do not add an exemption — move the last composition step into the test.

## Ports declared to RETURN a decision must be made total at the boundary

If a contract says a port returns `{ok:false, reasonCode}`, a port
implementation that *throws* escapes the orchestrator as an unhandled rejection
and can leave an in-flight guard stuck RUNNING forever. Orchestrators often
guard only the one port they expected to be flaky (the network one).

**Why:** the adapter layer owes totality to the contract above it. Fixing this
in the accepted orchestrator would change accepted code; fixing it in the
composition is the correct layer.

**How to apply:** wrap every port impl in one `guarded()` helper that maps a
throw to the port's own coded-failure shape. Label the failure with the error
**class only** — pg/fetch/parser messages carry URLs and connection strings.
Sinks the orchestrator calls without a catch (audit/logger) must swallow their
own throw: the outcome is already decided by the time the sink runs.

**Testing note:** run-scoped ports that refuse on ordering (e.g. "calendar not
resolved yet") never reach their dep from a bare port call, so a throw-injection
test on them must drive a full run. Assert the ordering refusal separately.
