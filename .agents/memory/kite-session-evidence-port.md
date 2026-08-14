---
name: Kite session evidence port + authenticated owner-route proof
description: Why a permanently-null evidence getter is an unfinished boundary, and why an owner route must be proven through the real login flow rather than a forged cookie or a direct snapshot assertion.
---

## A getter hardcoded to `null` is not a closed boundary

A gate whose evidence source returns `null` unconditionally *blocks* correctly but
*proves* nothing: it never answers "would we believe a real record?". The blocking
behaviour and the acceptance rules are two different questions, and the stub only
ever exercises the first.

**Why:** the safety of such a gate rests entirely on the stub staying a stub. The
first adapter that wires a real source arrives with no acceptance rules written,
no rejection codes, and no tests — at precisely the moment the answer starts
mattering.

**How to apply:** implement the port with a real accept/judge path and an
in-process store, keep the production store *empty* so the live verdict stays
NOT_EVALUATED, and test acceptance against records the test submits itself.
Empty-store NOT_EVALUATED and "credentials configured" must be distinct codes —
credential presence is not validation.

Port rules worth keeping:
- Enforce approved-source provenance at **both** accept time and judge time; a
  record that bypasses accept must still be refused by the judge.
- Refuse unknown fields rather than ignoring them, or a caller can smuggle an
  access token into stored evidence.
- Reject `validatedAt <= existing` (not just strictly older): two records
  claiming the same instant cannot both be right, so replacing one requires an
  explicit invalidation step.
- Freeze and copy on read *and* on write, so neither the submitter's reference
  nor a reader's copy can mutate the store.
- Treat `validUntil` as exclusive and re-judge expiry at the caller's `nowMs`
  every time — never cache a verdict.
- Keep the reset helper test-only and assert zero production callers by grepping
  source, not by assuming.

## Proving an owner-only route

**Do not forge the cookie.** Prior art in this repo mints an owner cookie by
HMAC-signing the session value directly. That proves the signature algorithm,
not the route: it skips the login endpoint, the password check, and any future
change to how sessions are issued.

**Do not assert the evaluator snapshot directly either** — that tests the
evaluator, not the endpoint, and says nothing about middleware or serialisation.

**How to apply:** POST the real login route with the configured access password,
reuse the returned `Set-Cookie`, and hit the real router mounted on a throwaway
Express app (loopback, ephemeral port, real `cookieParser(SESSION_SECRET)`).

To make route/evaluator parity a real claim rather than a tautology, extract the
payload builder out of the handler so the route becomes transport only, and have
it take `nowMs` as a parameter. The response then names the instant it describes,
so re-running the builder for that instant reproduces the tree **exactly** — deep
equality with zero normalisation, which is far stronger than field-by-field
comparison with drift allowances.

**Handle-leak baselines must be taken after the listener binds**, or the fixture's
own server counts as a leak.

## Secret-scan false positives

A key-name regex for credential-shaped fields will flag legitimate domain names
(`tokenReconciliation` — exchange *instrument* tokens, public reference data).
Allowlist by name only while additionally asserting that subtree contains only
coded values; excusing the name without checking the value makes the assertion
decorative.
