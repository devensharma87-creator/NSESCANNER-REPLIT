---
name: Canonical exchange-qualified instrument identity
description: Why live quotes are keyed by canonicalInstrumentId instead of trading symbol, and the rules any new instrument-identity code must follow.
---

# Canonical instrument identity

Live quotes and any future canonical series are keyed by an exchange-qualified
identity, never by trading symbol.

Format: `<EXCHANGE>:<SEGMENT>:<TRADING_SYMBOL>` (e.g. `NSE:EQUITY:RELIANCE`).
Exchange and segment are closed sets. The trading symbol is trimmed/upper-cased
and rejected if it contains `:`, so the encoding round-trips unambiguously.

**Why:** 2,280 trading symbols exist on both NSE and BSE. A symbol-only key let
one exchange's tick overwrite the other's. The exposure was latent, not active —
only NSE instruments were ever subscribed — but it blocked any BSE expansion.

**How to apply:**
- Resolve `providerInstrumentToken → canonical identity` *before* deciding where
  to store anything. Symbol must never determine storage location.
- The canonical id contains no provider token, so adding Upstox alongside Kite
  does not change any id. Provider tokens live in a separate mapping layer.
- Never deduplicate cross-listed companies by ISIN. An NSE listing and a BSE
  listing are two distinct market instruments with separate order books.
- Symbol lookup is a *secondary convenience*. When a symbol resolves to more
  than one exchange, return an explicit AMBIGUOUS result. Never default to NSE.
  The compatibility accessor returns null on ambiguity rather than guessing.
- Only a whitelisted provider may write to the live store, and a tick whose
  token is unregistered is rejected. That is what keeps fixture data out.

## Index aliases are many-to-one

Several Yahoo-style aliases can share one Kite token (`^CNXFIN` and
`NIFTY_FIN_SERVICE.NS` are both `NIFTY FIN SERVICE`, token 257801).

The pre-canonical code kept a `Map<token, symbol>`, so the first alias won and
every later alias for the same token became **permanently unresolvable** —
a silent live defect, not a theoretical one. Any token→name map is vulnerable to
this. Register all aliases against one identity instead.

`primaryAlias` is the preferred display key (the Yahoo alias for indices, the
NSE symbol for equities). It MUST be chosen by an explicit declaration, falling
back to the lexicographically smallest alias — **never by position in the alias
list or the source table**.

**Why:** a positional rule ("first alias wins") makes the public snapshot key
and the SSE payload silently depend on source-table iteration order, so an
unrelated reordering rekeys a public surface. It is also non-deterministic
across restarts once more than one row declares a preference.

**How to apply:** when several rows share one token, exactly one must declare
the preference. If two declare it, sort and warn rather than letting whichever
row was seen last win.

## Identities outlive the socket

Identities are immutable market facts and deliberately survive ticker
disconnects and restarts; only quotes are cleared. Do not clear the registry on
reconnect.

## Kite numeric fields

Kite's CSV-backed dumps can yield `instrument_token`/`exchange_token` as
strings. Coerce with `Number()` and validate before using them as a key — a
string token silently fails an integer check and drops the instrument.

## Rotating a provider token must not orphan a subscription

The provider caps concurrently subscribed tokens (Kite: 9,000). An orphan token
consumes that entitlement while delivering ticks that resolve to nothing, so a
rotation that installs the new token and forgets the old one is a *capacity*
regression even though every functional test passes.

**Why:** the two failure modes are asymmetric and both are silent. Leaving the
old token subscribed burns entitlement invisibly. Retiring the old token but
failing to subscribe the replacement leaves the instrument dark while the
in-memory subscription set still claims it is covered — which also blocks the
retry, because the set is what the next pass consults.

**How to apply:**
- Treat the whole rotation as one transaction and put the replacement's
  subscribe *inside* it. Never retire the old token and leave the replacement
  to a later batch subscribe that can fail independently.
- Order: unsubscribe old → unmark old → subscribe replacement → commit the
  registry → mark replacement. Every failure unwinds to exactly ONE active
  token.
- A rotation must never be reachable from an ordinary `register()` call. Split
  it into prepare (pure inspection) and commit (atomic swap) so the caller is
  forced to retire the subscription first.
- When it cannot be done safely, reject explicitly, keep the existing valid
  token live, install nothing, and queue the identity for a controlled
  resubscription cycle. Silence is the failure mode to design against.
- Evict the cached quote on a successful rotation: it was priced off a token
  that no longer identifies the instrument.

## Client state must be keyed by identity too

Fixing storage identity on the server is not enough. Any client keying its own
state by `symbol` (e.g. an SSE consumer doing `next[t.symbol] = t`) re-collapses
NSE and BSE into one row. Check that snapshot and incremental events use the
*same* key, or one instrument appears twice.
