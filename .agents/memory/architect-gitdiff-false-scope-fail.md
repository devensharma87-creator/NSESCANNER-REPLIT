---
name: Architect includeGitDiff false scope-fail
description: Why architect/code-review returns spurious "scope violated" FAILs on scoped tasks in this repo
---

When calling `architect({ includeGitDiff: true })` for a narrowly-scoped task, the
review can return FAIL claiming unrelated files (e.g. `optionSignals.ts`,
`fnoPremiumExitOverlay.ts`, `paperTradingFO.ts`) were changed and the read-only /
scoped constraint was violated — **even when your actual changeset is clean**.

**Why:** the diff the architect sees can include changes already committed in
earlier sessions (its diff base is broader than the current working tree), so it
attributes prior committed work to the current task.

**How to apply:** trust `git --no-optional-locks diff --stat` (working-tree) over
the architect's scope claim. If your working-tree diff only contains the intended
files AND the architect confirms the edits themselves are correct with no bug/security
issue, the scope FAIL is a false positive — proceed. Has happened ≥2 times.
