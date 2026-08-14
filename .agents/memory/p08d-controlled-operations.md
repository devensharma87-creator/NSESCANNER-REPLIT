---
name: Phase 0.8D controlled operations — durable rules
description: Design rules for implemented-but-disabled operational adapters, plus two guard-test traps and two stale pre-existing tests in api-server.
---

# Controlled operations: implemented but disabled

## Two authorization constants, never one

Refreshing reference data must not imply authorizing live market data, and
validating a broker session must not require first authorizing the activation
that the validation evidence exists to gate.

**Why:** a shared lock creates a circular gate — you cannot produce the proof
without flipping the thing the proof is supposed to justify.

**How to apply:** every new controlled operation gets its own compile-time
constant, defaulting false, unreachable from HTTP.

## Evidence retention on failure is asymmetric

- Provider auth rejection and account-identity mismatch **revoke** any held
  validation record.
- Transport failure (timeout / network / 5xx / rate-limit) **retains** it.

**Why:** a timeout is a statement about the network, not about the credential.
Revoking on a blip destroys good evidence; the record still carries its own
expiry, so the downstream gate re-judges it against the clock anyway.

**How to apply:** any validator feeding an evidence store needs "we could not
tell" as a distinct outcome from "it is bad", with distinct reason codes.

## A 200 for the wrong account is INVALID, not VALID

The most dangerous possible success. Identity match must be an explicit gate,
never inferred from HTTP status.

## Authority expiry is re-asked at commit time on a freshly read clock

A refresh spanning IST midnight crosses the BSE current-day boundary mid-flight.
Carrying the run-start timestamp forward silently commits expired authority.

## Promotion follows verification, never commit

Promote to active authority only after a cold load returns **the same
generation id** that was just committed. A failed verification leaves the row
committed but unpromoted, so the previous authority keeps serving. Report
`COMMITTED=true` honestly in that case, or the next run's duplicate no-op looks
inexplicable.

A duplicate is a **success** that promotes nothing and prunes nothing.

## Delegate to the persistence boundary

`saveRegistryGeneration` already owns pre-commit validation, the advisory lock,
`ON CONFLICT DO NOTHING`, and retention. Re-implementing those in an
orchestrator puts them **outside the transaction**, which is fail-open.

# Guard-test traps (both hit in this phase)

## A structural scan that includes the guard file is vacuous

A test asserting "the `__TEST_ONLY_` factories are exercised somewhere" scanned
every test file **including itself** — and the file lists both factory names in
its own `OVERRIDES` array, so it passed unconditionally.

**How to apply:** exclude `__filename` from self-referential scans, and prefer
actually invoking the thing over grepping for its name. The strong version runs
both factories and asserts the override *changes the authorization outcome*.

## Source scans must strip comments, not weaken the assertion

A "no SDK import" scan failed on the adapter's own doc comment explaining why
`KiteConnect.getProfile()` is the approved operation. The fix is a
comment-stripper that **preserves string literals** (import specifiers and
hardcoded URLs live in strings and are real findings) — not deleting the token
from the forbidden list.

## Credential-shaped key scans: rename, do not allowlist

The owner readiness payload is scanned for keys matching
`/token|secret|password|cookie|apikey|authorization|bearer|credential/i`.
A diagnostics field named `authorizationId` (holding a lock constant's *name*)
tripped it. Renamed to `governingLockId`.

**Why:** an allowlist entry has to be re-justified by every future reader, and
each one makes the guard more decorative. Renaming cost nothing and the new
name is more accurate — it is a lock, matching the `locks` block vocabulary.

# Two stale pre-existing api-server tests (as of 2026-08-14)

Both fail at HEAD, independent of any 0.8D work, and both were broken by the
Aug 13 graceful-shutdown refactor:

- `registryBootRestore.p07b.test.ts` **T27** greps `index.ts` for `app.listen(`;
  the refactor moved to `server.listen(`.
- `p08aSafety.test.ts` **P7** forbids the substring `apiKey` in `dataHealth.ts`;
  the route gained an `apiKeyOwnerId` **owner-identity** field (not a credential).

Do not attribute these to a current diff. Fixing them is its own scoped task.
