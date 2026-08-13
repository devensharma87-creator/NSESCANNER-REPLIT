---
name: Evidence scripts must assert, not print
description: Why one-off proof/evidence scripts have to fail closed, and the two scan patterns that produce false verdicts (naive secret/payload substring scans, unbaselined handle counts).
---

An evidence script that prints numbers and exits 0 is not evidence. If a human
has to read the output carefully to decide whether the run proved anything, the
exit code means nothing and a later re-run silently degrades.

**Rule:** every condition the run exists to prove is an assertion that collects
into a failure list; the process exits non-zero if the list is non-empty. That
includes the preconditions about *what was loaded*, not just the results —
source tier (durable store vs disk fallback), the exact generation/version id,
and settled state. A loader with a legitimate fallback path will happily give
you a different input and every downstream number will still look plausible.

**Why:** a proof run against the wrong input, or one that skipped the condition
it was written for, reads identically to a successful one. Twice in one session
a green print-only script was accepted as closure evidence and was not.

**How to apply:** when writing a `scripts/*.evidence.ts` / proof script, list
the directive's required conditions first, turn each into `assertTrue(name,
cond, detail)`, and make the last line a PASS/FAIL with an exit code.

## Scans that produce false verdicts

- **Secret/payload substring scans over a JSON body.** Domain responses are full
  of upper-snake enum codes (`OWNER_ACTIVATION_AUTHORIZATION`,
  `KITE_SESSION_VALID`) and sha256 hashes, so searching for `authorization`,
  `session`, `secret`, or a six-digit id yields hits with no leak behind them
  (a numeric token *will* appear inside some hash). Replace with: (a) a
  recursive scan of **keys and scalar values** against credential-bearing key
  names, (b) "no environment variable value of length >= 8 appears in the body"
  — precise and prints no secret, (c) membership of real payload ids in the
  parsed value/key set, not the raw text, and (d) a structural bound (body size
  and longest array) that makes a payload impossible rather than unobserved.
- **Field-by-field metadata checklists.** They cannot catch an *extra* field or
  a nested object that starts serialising a payload. Rebuild the entire expected
  response from the direct evaluation and compare key-sorted whole trees,
  normalising only wall-clock stamps.
- **Residual handle counts.** `getActiveResourcesInfo()` legitimately shows the
  DB pool socket and stdio pipes. Baseline handles *after* setup and *before*
  the behaviour under test, then assert the delta is empty.
