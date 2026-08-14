---
name: Generation timestamp ordering and the pre-commit boundary
description: Why a generation must be stamped as of its last input, and why the cold-load authority boundary has to be re-applied before the write.
---

## Rule 1 — a generation is as of its LAST input, never its first moment

Stamping a built artefact with the instant the run *started* makes it pre-date
the evidence it was built from. Any rule of the form "evidence dated after the
artefact carrying it cannot have produced it" then fires against every honest
run.

Derive the stamp as `max(fresh clock reading at build time, latest source
retrieval instant)`. The `max` matters: a clock that steps backwards mid-run
would otherwise re-create the same inversion.

**Why:** the first authorized live registry refresh wrote an ACCEPTED, newest
generation whose committed BSE List-of-Scrips retrieval was ~6 s later than the
generation's own `generatedAt`. Boot refused it permanently, and retention had
already pruned an older row to make space for it.

**How to apply:** wherever an orchestrator threads a single `nowMs` through a
whole run, ask which steps *happen after* that reading. Anything stamped with
it is claiming to exist before its own inputs.

## Rule 2 — a gate that runs after the write cannot prevent the write

Cold-load / re-read verification that runs *after* persistence detects a bad
artefact but cannot stop it being stored, promoted to newest, or displacing a
good row under retention. Re-apply the same boundary one step earlier, before
the write, and refuse there.

Re-apply it by **calling the same evaluator**, injected as a dependency — never
by re-deriving the judgement at the new site. A second implementation drifts,
and drift here is fail-open: it passes artefacts that boot then rejects.

An evaluator that throws leaves the question unanswered, and an unanswered
integrity question is a refusal, never a pass.

**How to apply:** test it by asserting the *writer was never called*, not by
asserting the reason code — a reason-code assertion passes just as happily when
the gate runs last and throws its verdict away.
