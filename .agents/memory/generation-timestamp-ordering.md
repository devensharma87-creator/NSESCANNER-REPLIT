---
name: Generation timestamp must not precede its own source evidence
description: Why a run-start clock stamp poisons a committed registry generation, and what the ordering rule has to be.
---

A generation whose `generatedAt` is taken at run start will be **earlier** than
the retrieval timestamps of the sources it is built from, because the sources
are fetched after the run begins. Any validator asserting "source evidence
cannot post-date the generation it belongs to" then rejects the generation at
cold-load — after it has already been persisted and marked ACCEPTED.

**Why it matters:** the row survives in the store as the newest ACCEPTED
generation while being permanently unloadable. Boot restoration rejects it, and
whether the previous good generation is still reachable depends on retention
having kept it. Retention pruning at commit time can therefore turn one bad
commit into a lost authority chain.

**How to apply:**
- Stamp `generatedAt` from the LAST source retrieval (or later), never from run
  start — the generation is not "as of" a moment before its own inputs existed.
- Validate the ordering **before** persistence, not only at cold-load
  verification. A gate that runs after the write cannot prevent the write.
- Treat "committed but cold-load-rejected" as a state needing explicit cleanup
  authorization; do not silently delete rows to make the store look clean.
