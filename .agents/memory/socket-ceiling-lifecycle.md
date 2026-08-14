---
name: Bounded-socket feed lifecycle rules
description: Rules for any component that owns a hard-capped number of provider connections (Kite ticker = 3 per API key) — what counts against the cap, and why lifecycle operations must be serialized.
---

# Bounded-socket feed lifecycle

## An emptied slot is not a released socket

Clearing the local reference to a connection says nothing about whether the
provider still counts it. Anything whose `close()` refused or threw must go on
an explicit **unreleased ledger** and keep counting against the cap.

The socket budget is therefore `held + unreleased`, never `held`.

**Why:** dropping a client whose close failed produced four separate
symptoms from one root cause — a startup that reported `clientsHeld: 0` with
live sockets, a reconnect that needed a 4th connection, a shutdown that exited
0 dishonestly, and (found only by a test) a *second* reconnect that sailed
past the guard because the first attempt had already emptied the slot.

**How to apply:** on any release failure, retain the client. Refuse to start
when the ledger is non-empty, refuse to construct a replacement when
`held + unreleased >= cap`, and make close throw rather than report success.
"We own nothing" requires an empty slot set *and* an empty ledger.

## Serialize lifecycle operations, don't reserve slots

Every socket-owning operation releases something and then awaits. That await
is a window where another caller sees a half-torn-down world: a slot already
emptied whose socket is not yet on the ledger. Two concurrent reconnects each
conclude there is room and open a connection.

**Why:** proving correctness by reserving a slot at every await point means
re-checking state after each one and getting all of them right. A single
mutex around start/reconnect/close removes the window entirely and is far
easier to prove. Deadlock-free as long as no exclusive operation calls
another.

**How to apply:** chain operations on a tail promise; make the tail swallow
rejections or one failed operation poisons every later one. State checks then
happen inside the lock, so "reconnect after shutdown" is refused by the
ordinary state guard for free.

## A returning call is not a provider acknowledgement

The Kite ticker's `subscribe()` is fire-and-forget over an open socket, and
`connect()` only *requests* a connection — the socket is open when the
`connect` event fires, not when the call returns.

**Why:** returning `ok` at request time lets the manager subscribe to a dead
socket and then declare RUNNING: a feed that reports healthy and delivers
nothing. Echoing requested tokens back as `acceptedTokens` hides the same
failure one layer up.

**How to apply:** await the provider's event behind a settle-once latch with a
timeout, and treat a timeout as failure, never as assumed success. A
disconnect *before* the handshake is a failed connect, not a lost shard — it
must not be reported to the manager as a shard it never held. Carry an
explicit `PROVIDER_ACKNOWLEDGED | REQUEST_ACCEPTED_UNCONFIRMED` field rather
than letting a caller read a bare `ok` as agreement, and refuse to subscribe
unless the socket is currently connected.

## Falsify concurrency tests

A race test that passes without the fix is worthless. Temporarily bypass the
guard and confirm the test fails before trusting it. Fakes must also take real
asynchronous time (`setTimeout`), or both operations complete in one microtask
and the interleaving under test never happens.
