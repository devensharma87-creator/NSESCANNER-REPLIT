---
name: NaN/Infinity comparisons fail OPEN in risk gates
description: Why fail-closed risk/validation modules must validate finiteness+sign of every numeric input AND config before any threshold comparison.
---

# NaN/Infinity numeric comparisons fail OPEN

In a fail-closed risk/validation gate, the single most common silent hole is the
`NaN`-makes-comparison-false trap: `NaN > cap`, `NaN >= cap`, `NaN < min` are **all
false**, and `NaN` arithmetic produces `NaN` percentages. So one missing/`NaN`/`Infinity`
input slips past every threshold check and the candidate reads as
"safe / fresh / liquid / clear / within-cap / sized" — i.e. the unguarded path fails **OPEN**.

**Rule:** every numeric guard must validate `Number.isFinite()` **and sign** of all its
numeric **inputs AND config values** *before* any threshold comparison, returning an explicit
hard-block / REVIEW_REQUIRED reason. A negative cap should also be treated as invalid (or it
must at least fail *stricter*, never looser).

**Why:** building the swing-cash risk pack (`artifacts/api-server/src/lib/swingCash*.ts`) took
**five** architect rounds purely to find these holes one module at a time — entry-gate freshness,
data-trust `nowMs`, sizing inputs/config, event-risk `daysToResult`, exposure inputs/config, and
the composer's portfolio counters/caps. Each was the same pattern in a new place.

**How to apply:**
- New leaf gate → add a top fail-closed guard over its own inputs+config first thing.
- Composer/aggregator → also guard any counter/cap it compares *directly* (it doesn't inherit a
  leaf's guard); add an explicit block reason to the union so the block is transparent, and make
  sure the leaf's `allowed=false` actually feeds the aggregate `cleanPass`.
- Always add NaN/Infinity/negative regression tests per module + a composer-propagation test, or
  the hole silently reappears.
- Also applies to the same "missing → omit/label, never fabricate" stance: `?? 0` / `?? true`
  defaults on a risk-relevant field re-introduce the fail-open behaviour.
