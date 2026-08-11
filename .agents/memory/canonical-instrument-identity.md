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

`primaryAlias` preserves the exact key legacy consumers already use (the Yahoo
alias for indices, the NSE symbol for equities). Explicit aliases are ordered
before the trading symbol so this stays stable; changing that order silently
rekeys the `/api/kite/quotes` snapshot and the SSE payload.

## Identities outlive the socket

Identities are immutable market facts and deliberately survive ticker
disconnects and restarts; only quotes are cleared. Do not clear the registry on
reconnect.

## Kite numeric fields

Kite's CSV-backed dumps can yield `instrument_token`/`exchange_token` as
strings. Coerce with `Number()` and validate before using them as a key — a
string token silently fails an integer check and drops the instrument.
