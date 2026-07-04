---
name: Detecting BUILD_NOT_DEPLOYED via deployment log boot events
description: How to tell whether a production autoscale deployment actually redeployed after a commit, vs. is still serving an older build.
---

Autoscale does not restart on `git commit` — a commit landing on `main` proves nothing about what's live until the owner republishes. `getDeploymentInfo()` only reports `hasSuccessfulBuild: true` for whatever the *last* publish was; it has no per-commit/version marker.

**How to apply:** to verify a specific commit is actually live in production:
1. Get the commit's timestamp (`git log -1 --format=%cI`, convert to epoch ms).
2. `fetch_deployment_logs` filtered on `message: "artifact process started|artifact port detected"` (no time filter) to see the full boot-event history, then also query with `after_timestamp: <commit epoch>` specifically.
3. If zero boot events exist after the commit timestamp, and ongoing request traffic in the logs is served by the same pid that booted *before* the commit, the running process predates the commit — the build has not been redeployed, regardless of what the owner's message implies ("app is ready to be published" is ambiguous; verify, don't assume).
4. This is a legitimate distinct verdict state (e.g. `BUILD_NOT_DEPLOYED`), not a rollback or partial-gap condition — the source can be fully correct and tested while simply not yet live.
