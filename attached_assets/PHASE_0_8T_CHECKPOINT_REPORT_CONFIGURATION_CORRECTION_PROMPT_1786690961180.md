# PHASE 0.8T — CHECKPOINT REPORT CONFIGURATION CORRECTION

Use **Economy mode**. This is a read-only evidence correction. Do not change source, configuration, tests, Git history, deployment state, providers, databases or feeds.

## Accepted checkpoint

The Phase 0.8T development checkpoint at `2bad77b35d2ca588bc7bdb5efa66a03290f3b26f` is otherwise accepted. The three inspected platform auto-commits are within the authorized Phase 0.8T scope.

Do not recreate, amend, squash, reset, revert or replace the checkpoint.

## Material reporting contradiction to correct

Section 13 of the checkpoint report states both:

- `deploymentTarget = "vm"` remains inert until Publish; and
- Reserved VM has not been configured because `artifacts/api-server/artifact.toml` does not exist.

That conclusion is not supported by the inspected path and contradicts the earlier Phase 0.8T evidence.

The deployment target is controlled by the repository’s actual Replit deployment configuration, primarily the root `.replit` file. The API artifact manifest previously identified in this project is:

`artifacts/api-server/.replit-artifact/artifact.toml`

Checking `artifacts/api-server/artifact.toml` is checking the wrong path. Absence at that wrong path cannot prove that Reserved VM is unconfigured.

## Required read-only correction

Using Git/file reads only:

1. Read the committed root `.replit` at current HEAD.
2. Record the exact `[deployment]` section and `deploymentTarget` value.
3. Read the committed API artifact manifest from its actual path:

   `artifacts/api-server/.replit-artifact/artifact.toml`

   If the actual committed manifest path differs, locate it with `rg --files` and report the exact path—do not infer absence from one guessed path.
4. Record the API artifact’s build command, run command, port/path routing and health-check configuration only as relevant to the topology report.
5. Inspect Git history to identify the commit in which `.replit` changed from `autoscale` to `vm`, if that change is present at HEAD.
6. Distinguish these three states precisely:
   - **repository configuration:** what current committed `.replit` declares;
   - **currently running production topology:** not re-queried in this correction and therefore unchanged/unverified by this pass;
   - **future Publish effect:** repository `vm` configuration remains inert until a separately authorized Publish creates/replaces a deployment.
7. Correct the report without changing files unless an existing tracked report contains the incorrect statement. If a tracked report must be corrected, stop and request separate write authorization rather than editing it now.

## Required corrected language

If root `.replit` contains `deploymentTarget = "vm"`, the report must say substantially:

> The repository is configured to request a Reserved VM on the next authorized Publish. This configuration is committed but has no effect on the currently running deployment until Publish occurs. The current production deployment was not queried in this checkpoint pass, so its live topology is not re-proven here. Runtime singleton admission remains blocked until the Reserved VM is actually published and attested.

It must **not** say:

- Reserved VM is “not configured” merely because `artifacts/api-server/artifact.toml` is absent;
- configuration is absent when `.replit` declares `vm`;
- production is already running on Reserved VM;
- repository configuration alone proves runtime singleton ownership.

If `.replit` does **not** contain `deploymentTarget = "vm"`, report the exact observed value and stop with:

`PHASE_0_8T_CONFIGURATION_EVIDENCE_MISMATCH — RESERVED_VM_TARGET_NOT_PRESENT_AT_CHECKPOINT`

Do not silently edit `.replit`.

## Cost-control and side-effect restrictions

Do not run:

- tests;
- TypeScript;
- builds;
- `git diff --check`;
- server restart or boot proof;
- browser or production request;
- provider, WebSocket or subscription action;
- database query or write;
- deployment or Publish action.

Do not commit, push, merge or modify history. Use direct file reads and Git inspection only.

## Required corrected report

Return only:

1. exact `.replit` deployment configuration observed at HEAD;
2. exact artifact-manifest path and relevant build/run/health settings;
3. commit where `autoscale → vm` occurred, if present;
4. corrected distinction between repository configuration, live production topology and future Publish effect;
5. confirmation that checkpoint SHA `2bad77b3` remains unchanged;
6. confirmation that no files, tests, builds, server, production, database, provider or deployment were touched;
7. confirmation that feed remains disabled and Phase 0.8B has not started;
8. the remaining blockers: pre-publish production identity capture, actual Reserved VM publication, runtime attestation, current registry authority, Kite-session validation and explicit owner feed-activation authorization.

Stop with one of these exact verdicts:

If `.replit` is correctly set to `vm`:

`PHASE_0_8T_CHECKPOINT_EVIDENCE_CORRECTED — RESERVED_VM_REPOSITORY_CONFIGURATION_PRESENT_BUT_NOT_DEPLOYED — LIVE_SINGLETON_TOPOLOGY_NOT_YET_ATTESTED — FEED_REMAINS_DISABLED — OWNER_NEXT_PHASE_AUTHORIZATION_REQUIRED`

If it is not:

`PHASE_0_8T_CONFIGURATION_EVIDENCE_MISMATCH — RESERVED_VM_TARGET_NOT_PRESENT_AT_CHECKPOINT`

