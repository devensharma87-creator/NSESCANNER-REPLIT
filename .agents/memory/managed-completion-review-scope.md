---
name: Managed completion code-review is pinned to the PARENT task objective
description: Why a correct, deliberately-scoped slice gets REJECTED by mark_task_complete's managed code_review, and how to close it honestly.
---

# Managed completion code-review judges the PARENT project-task's "done", not your scoped slice

**Symptom:** `mark_task_complete` triggers a managed `code_review` validation that REJECTS even when the actual change is small, correct, tested, and already passed a targeted `architect` review. The rejection cites a much larger objective than what was worked on (e.g. "route every page through the trusted layer" / full migration + global signal-gate + site-wide badges) and lists "incomplete" surfaces you never touched.

**Why:** The managed validation (`validation.external.managed`, `commandId: code_review`, `externallyManaged: true`) evaluates the cumulative diff against the **parent project task's** acceptance criteria (its `.local/tasks/task-*.md` "Done looks like"). When you intentionally ship a scoped slice of a big deferred task, the parent's criteria are by definition unmet, so the gate fails regardless of slice quality. This is distinct from the `architect`-includeGitDiff scope-fail (that's the tool *I* invoke); this one is the platform completion gate.

**How to apply:**
- Don't churn on retries and don't silently undertake the whole parent migration to make the gate green — especially when the parent was deferred for live-prod/breaking-risk reasons.
- Verify the slice independently: working-tree `git diff --stat` (trust it over the review's scope claims), targeted `architect` review, full leaf test suite + typecheck, and a live/endpoint check.
- Surface the mismatch to the user and get an explicit decision. With sign-off, close via `mark_task_complete` `skip_validation_reason` documenting that the managed review targets the deferred parent objective, not this slice.
- **Precedent:** the Watchlist migration was closed the same way — scoped Kite-backed + provenance work accepted while the broader trusted-layer rollout stayed open.
