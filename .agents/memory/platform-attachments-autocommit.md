---
name: Platform attached_assets auto-commit governance
description: Replit platform auto-commits user-uploaded attached_assets files, causing unexpected HEAD movements during evidence tasks that stop governance-strict workflows.
---

## Rule

When an evidence or audit task requires strict governance on HEAD changes (e.g. "stop if HEAD changes"), the Replit platform will auto-commit every file the user uploads, causing HEAD to move. Each upload triggers one platform commit.

## Observed behaviour

- Each file uploaded by the user is auto-committed to `main` as a separate platform commit.
- Commit title is descriptive (e.g. "Add market scanner prompt authorization documentation") but the commit author is `Replit Agent <agent@replit.com>`.
- Changes are exclusively `status A` files under `attached_assets/`.
- These commits do NOT touch production source, tests, schemas, migrations, config, dependencies, evidence, or memory.

## Blanket authorization pattern

For governance tasks that require stopping on unexpected HEAD movement, the owner can grant:

`ATTACHED_ASSETS_ONLY_AUTO_COMMIT_EXCEPTION_GRANTED`

This allows the agent to continue without stopping when every changed item in an unexpected HEAD movement is:
- `status A` (new file, no modification/deletion)
- located exclusively under `attached_assets/`
- not a symlink
- unrelated to production code, tests, configuration, dependencies, evidence, or memory

**Still stop immediately if any commit**: modifies/deletes/renames an existing file, touches a path outside `attached_assets/`, or contains a merge commit or unexpected parent structure.

## Governance exception classification

When a blanket authorization is in effect, record every such auto-commit in the final Git chronology as "platform auto-committed attached_assets file — blanket exception applies."

**Why:** Requiring a new authorization file for each auto-commit creates a loop — each authorization file upload itself triggers another auto-commit, perpetuating the problem.

## Related: test-file in documentation commit

Commit `be186dd` shows a secondary risk: a platform auto-commit with a documentation-only title can silently include a test-file change (the stale-date fixture fix). Always run the range diff `git diff --name-status <old>..<new>` to verify no non-documentation files are present — never trust the commit title alone.
