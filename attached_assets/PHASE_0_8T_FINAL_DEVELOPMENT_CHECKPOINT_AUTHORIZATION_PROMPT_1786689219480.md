# PHASE 0.8T — FINAL DEVELOPMENT CHECKPOINT AUTHORIZATION

Use **Economy mode**. This authorization is for Git checkpointing and evidence reporting only. Do not implement, refactor, test, build, restart, deploy, publish, activate, or contact any provider or database.

## Accepted development verdict

The final Phase 0.8T correction is accepted for a development checkpoint:

`PHASE_0_8T_READY_FOR_FINAL_CHECKPOINT — SHUTDOWN_INSTALLATION_REENTRANCY_SAFE — ROLLBACK_CAPABILITY_GUARANTEED — STARTUP_REFUSAL_BEHAVIOURALLY_PROVEN — LISTENING_IMPOSSIBLE_BEFORE_LIFECYCLE_READINESS — ZERO_RUNTIME_OR_FEED_SIDE_EFFECTS`

This is **not** deployment authorization and **not** feed-activation authorization.

## Authorized source/test scope

Checkpoint only the accepted final correction files:

1. `artifacts/api-server/src/lib/lifecycle/gracefulShutdown.ts`
2. `artifacts/api-server/src/lib/lifecycle/startupListenerPhase.ts`
3. `artifacts/api-server/src/index.ts`
4. `artifacts/api-server/src/lib/lifecycle/gracefulShutdown.p08t.test.ts`
5. `artifacts/api-server/src/lib/lifecycle/startupListenerPhase.p08t.test.ts`

Related memory/report files may be included only if they exclusively record this accepted correction. Do not include uploaded owner directives under `attached_assets/` unless the platform has already auto-committed them and they are inert.

## Mandatory pre-commit inspection

Before staging or accepting an auto-commit:

1. Record branch and HEAD.
2. Run `git status --short`.
3. Inspect the complete diff and exact changed-file list.
4. Classify every changed or untracked file as:
   - authorized source;
   - authorized test;
   - directly related inert report/memory;
   - owner directive/attachment;
   - unrelated.
5. Stop immediately if any unrelated runtime, schema, migration, dependency, lockfile, configuration, generated, build-output, provider, database, feed, F&O, Swing, candle, indicator, safety-lock or deployment file is present.

Stop code:

`PHASE_0_8T_CHECKPOINT_BLOCKED — UNRELATED_CHANGE_PRESENT`

## Platform auto-commit rule

The platform may auto-commit before manual staging.

If HEAD moved:

1. inspect every intervening commit;
2. list its exact author, timestamp, SHA and files;
3. retain it only if it contains exactly the authorized Phase 0.8T files plus inert report/memory/directive files;
4. stop if any unrelated file is present;
5. do not reset, revert, squash, amend, cherry-pick, rebase or rewrite history.

If the accepted files are already fully committed by a compliant platform auto-commit, create no duplicate commit.

## Checkpoint action

If the accepted files remain uncommitted and the inspection is clean:

1. stage only the authorized files explicitly—do not use `git add .` or `git add -A`;
2. verify the staged file list and staged diff;
3. create one development checkpoint commit with a precise message such as:

   `Complete Phase 0.8T atomic shutdown lifecycle and startup proof`

4. do not add the current owner-authorization directive;
5. do not push, merge or deploy.

## Evidence only—do not repeat compute

Do not rerun:

- tests;
- TypeScript;
- `git diff --check`;
- builds;
- server/workflow restart;
- boot proof;
- browser session;
- production request;
- database query;
- provider request;
- WebSocket or subscription evidence.

The accepted evidence already stands: 98/98 targeted tests, TypeScript clean and `git diff --check` clean.

Use only Git inspection and direct file reads needed for the checkpoint report.

## Required checkpoint report

Report:

1. final commit SHA, author, timestamp and message;
2. whether the checkpoint was manual or a platform auto-commit;
3. parent/intervening auto-commit inspection, if any;
4. exact committed file list with classifications;
5. exact files intentionally excluded;
6. diffstat;
7. final `git status --short`;
8. current branch and HEAD;
9. confirmation that local `main` was untouched;
10. confirmation that nothing was pushed, merged, rebased, reset, reverted or deployed;
11. confirmation that no test, build, restart, boot, database, provider, WebSocket or subscription action was performed;
12. confirmation that all four safety locks remain exactly `false as boolean`, using direct source reads only;
13. confirmation that `deploymentTarget = "vm"` remains inert until a separately authorized Publish;
14. remaining blockers:
    - pre-publish live production rollback-identity capture;
    - actual Reserved VM publication;
    - runtime singleton/platform attestation;
    - current authoritative registry refresh/authority;
    - Kite-session validation;
    - explicit owner feed-activation authorization;
15. explicit statement that Phase 0.8B has not started.

Stop after the report with:

`PHASE_0_8T_DEVELOPMENT_CHECKPOINT_COMPLETE — RESERVED_VM_CONFIGURATION_PREPARED_NOT_DEPLOYED — ATOMIC_SHUTDOWN_LIFECYCLE_RETAINED — STARTUP_REFUSAL_BEHAVIOURALLY_PROVEN — FEED_REMAINS_DISABLED — OWNER_NEXT_PHASE_AUTHORIZATION_REQUIRED`

