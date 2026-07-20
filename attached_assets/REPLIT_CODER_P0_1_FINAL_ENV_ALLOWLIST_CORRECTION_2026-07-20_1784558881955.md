# NSESCANNER — P0.1 FINAL STATIC CORRECTION

**Branch:** `phase0/authorized-remediation-20260720`  
**Expected starting SHA:** `4769eb345e89e6fd1496f749c5d0772cee383aa7` plus attachment-only checkpoints, if any  
**Scope:** Replace clone-and-denylist test-child environment with an explicit allowlist  
**No authority:** Database/network runtime tests, application source changes, trading changes, restart, deployment, merge or push

---

## Copy everything below into Replit Coder

P0.1 is still open. The final static review proved:

- `KILL_SWITCH_VALUE_SEMANTICS: PROVED_SAFE`;
- `UNKNOWN_SECRET_CHILD_LEAK: POSSIBLE`;
- `NODE_PRELOAD_CHILD_RISK: POSSIBLE`;
- `PROXY_ENV_CHILD_RISK: POSSIBLE`;
- child policy is `CLONE_AND_DENYLIST`.

Correct only these environment-sanitization defects. Do not begin P0.2 and do not run any database-backed or application test.

## 1. Verify baseline before editing

Provide literal output:

```bash
git branch --show-current
git rev-parse --verify HEAD
git rev-parse --verify main
git status --short --branch
git log -3 --oneline --decorate
```

Required:

- branch exactly `phase0/authorized-remediation-20260720`;
- main exactly `47611aa6fad3785f02f97280570f025c71fb975a`;
- source state based on corrective commit `4769eb345e89e6fd1496f749c5d0772cee383aa7`;
- only explainable attachment-only checkpoints/untracked attachments.

Stop before editing if source state differs.

## 2. Hard prohibitions

Do not:

- connect to any database;
- run `test`, `test:db`, existing application tests or the full suite;
- execute SQL, migrations, schema ensure, seeding or cleanup;
- invoke endpoints or start/restart workflows;
- contact Kite, Telegram, email/webhook services, IndianAPI, Upstox, Indstocks or any network service;
- modify production/runtime application code, DB modules, routes, schema, trading logic, C0 constants, UI or provider adapters;
- merge, rebase, push, publish or deploy;
- claim runtime database or network isolation is proved.

Permitted verification is limited to TypeScript typecheck and the exact positively allowlisted pure guard test.

## 3. Permitted files

Modify only:

1. `artifacts/api-server/src/test-infra/dbTestPreflightRunner.ts`
2. `artifacts/api-server/src/test-infra/dbTestGuard.test.ts`
3. `memory/P0_1_TEST_COUPLING_INVENTORY_2026-07-20.md`
4. `memory/P0_1_TEST_ISOLATION_IMPLEMENTATION_AND_EVIDENCE_2026-07-20.md`

Modify `dbTestGuard.ts`, `vitest.config.unit.ts` or `package.json` only if read-only inspection proves an unavoidable correction is required; declare the exact reason before touching them.

Platform-required `.agents/memory` updates may only correct factual P0.1 status. Do not treat them as production evidence.

Do not intentionally stage new `attached_assets/Pasted-*` files. Disclose unavoidable platform auto-capture.

## 4. Replace clone-and-denylist with an explicit allowlist

`buildIsolatedChildEnv()` must start from an empty object and copy only explicitly approved runtime keys.

It must not iterate the parent environment and retain the open complement of a denylist.

Export an immutable `CHILD_PROCESS_ENV_ALLOWLIST` containing only ordinary process-launch keys actually required by Node/Vitest in this repository. Candidate keys must be justified individually through static evidence, for example:

- `PATH` — locate Node/Vitest executable;
- `HOME` — package/runtime home where genuinely required;
- `TMPDIR`, `TMP`, `TEMP` — temporary files;
- `LANG`, `LC_ALL`, `LC_CTYPE` — locale;
- `TZ` — deterministic time zone;
- `CI`, `TERM`, `FORCE_COLOR`, `NO_COLOR` — test/output behaviour;
- platform-neutral package-manager/runtime keys only when proved necessary.

Do not include keys merely because they happen to exist in Replit.

After copying the explicit allowlist, set the following values internally rather than inheriting them blindly:

- `NODE_ENV="test"`;
- `DATABASE_URL=<validated TEST_DATABASE_URL>`;
- `TEST_DATABASE_URL=<validated TEST_DATABASE_URL>`;
- `TEST_RUN_ID=<validated run ID>`;
- `TEST_DB_ISOLATION_CONFIRMED="true"`;
- `TEST_EXTERNAL_SERVICES_MOCKED="true"`;
- actual project-recognized execution switches at verified disabled values.

The child environment must never inherit:

- original operational `DATABASE_URL`;
- `NODE_OPTIONS`, `NODE_PATH` or preload/loader variables;
- `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES` or equivalent injection variables;
- `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, `GRPC_PROXY` or lowercase variants;
- `NPM_CONFIG_PROXY`, `NPM_CONFIG_HTTPS_PROXY` or package-manager proxy variables;
- authentication, session, cookie, password, token, secret, private-key, webhook or API-key variables;
- Kite, Upstox, Telegram, IndianAPI, Indstocks, Apify, Resend, SendGrid or TradingView credentials;
- mirror URLs/allowed-host variables;
- `.env`/secret-file paths;
- metrics access tokens;
- any unknown future parent variable.

Because the policy is allowlist-based, unknown variables must be dropped automatically without maintaining an ever-growing secret denylist.

Existing `PRODUCTION_SECRETS` may remain as defence-in-depth/documentation, but security must not depend on its completeness.

## 5. Execution-switch controls

Preserve the already proved-safe values:

- `PAPER_TRADING_ENABLED="false"`;
- `REPLIT_DEPLOYMENT="0"`;
- `INDSTOCKS_ENABLED="0"`.

Statically inspect the remaining execution/scheduler flags identified in the final review, including:

- `CANDLE_WAREHOUSE_ENABLED`;
- `OPTION_SNAPSHOT_ENABLED`;
- `REASONING_WRITER_V2_ENABLED`;
- `PAPER_FO_COSTS_SHADOW_ENABLED`;
- `PAPER_FO_SHADOW_EXITS_ENABLED`;
- `FNO_SIGNAL_HYGIENE_V2`;
- `SWING_CASH_EXECUTION_MODE`;
- `LIVE_CASH_SWING_ORDER_ENABLED`;
- `SWING_SHADOW_DIAG_ENABLED`;
- other flags that can start background writes, external calls, alerts or broker actions.

For every such flag:

1. record its parser and absent/default behaviour;
2. explicitly set a disabled/safe test value when absence is not provably safe;
3. never disable a pure calculation merely to make tests pass;
4. keep C0 constants unchanged.

Do not modify production flag parsers.

## 6. Required pure tests

Expand the existing positively allowlisted guard test using dummy in-memory environments only.

Test at minimum:

1. output contains no key not present in the explicit allowlist or internally generated test keys;
2. a random unknown parent key is dropped;
3. a future secret such as `FUTURE_PROVIDER_API_KEY` is dropped without changing a denylist;
4. all previously identified leaked keys are dropped:
   - `KITE_TOKEN_ENC_KEY`;
   - `KITE_TOKEN_ENC_KEY_OLD`;
   - `KITE_TOKEN_ENC_KEY_NEW`;
   - `KITE_MIRROR_URL`;
   - `KITE_MIRROR_ALLOWED_HOSTS`;
   - `METRICS_TOKEN`;
   - `RESEND_API_KEY`;
   - `SENDGRID_API_KEY`;
   - `DEAD_SYMBOL_WEBHOOK_URL`;
   - `ENV_FILE_PATH`;
5. `NODE_OPTIONS` and `NODE_PATH` are dropped;
6. native preload/injection variables are dropped;
7. uppercase and lowercase proxy variables are dropped;
8. package-manager proxy variables are dropped;
9. operational `DATABASE_URL` is absent from all output values;
10. validated `TEST_DATABASE_URL` becomes child `DATABASE_URL`;
11. only justified runtime keys such as `PATH`/temporary/locale keys survive;
12. kill switches have exact safe values regardless of parent values;
13. fake spawn receives only the sanitized child environment;
14. no real spawn, socket, database or network call occurs.

Add a property-style test that supplies at least 100 arbitrary non-allowlisted environment keys and proves all are dropped.

Do not use real environment values or secrets.

## 7. Permitted verification

Run only:

- `pnpm --filter @workspace/api-server run typecheck`;
- the exact single-file positive unit configuration/test.

Do not run default `test` or `test:db`.

Report every attempt separately, including failures, skips and timeouts.

## 8. Evidence update

After verification, update the two P0.1 evidence documents to record:

- policy changed from `CLONE_AND_DENYLIST` to `EXPLICIT_ALLOWLIST`;
- exact allowlisted keys and justification;
- generated test-only keys;
- exact forced execution switches and parsing proof;
- all sensitive/preload/proxy categories dropped;
- focused test results;
- `UNKNOWN_SECRET_CHILD_LEAK: PROVED_ABSENT_AT_CHILD_ENV_CONSTRUCTION`;
- `NODE_PRELOAD_CHILD_RISK: PROVED_ABSENT_AT_CHILD_ENV_CONSTRUCTION`;
- `PROXY_ENV_CHILD_RISK: PROVED_ABSENT_AT_CHILD_ENV_CONSTRUCTION`;
- runtime DB/network proof remains not run.

Do not claim OS/container-level network isolation from environment sanitization alone.

## 9. Final report

Return:

- branch, start/final HEAD and main SHA;
- complete changed-file list;
- committed/staged/unstaged/untracked state;
- exact allowlist;
- exact generated test variables;
- all forced execution switches and their parser semantics;
- all test names and counts;
- typecheck result;
- confirmation of no DB/network/endpoint/restart/deploy/merge/push;
- attachment auto-capture;
- acceptance matrix.

Required labels:

`CHILD_ENV_POLICY: EXPLICIT_ALLOWLIST|FAILED`

`UNKNOWN_SECRET_CHILD_LEAK: PROVED_ABSENT_AT_CHILD_ENV_CONSTRUCTION|FAILED|UNPROVED`

`NODE_PRELOAD_CHILD_RISK: PROVED_ABSENT_AT_CHILD_ENV_CONSTRUCTION|FAILED|UNPROVED`

`PROXY_ENV_CHILD_RISK: PROVED_ABSENT_AT_CHILD_ENV_CONSTRUCTION|FAILED|UNPROVED`

`EXTERNAL_NETWORK_RUNTIME_ISOLATION: UNPROVED`

`TEST_DATABASE_ISOLATION_RUNTIME_PROOF: NOT_RUN_NO_DATABASE_AUTHORITY`

## 10. Stop rule

Make at most one local corrective checkpoint on the authorized branch. Do not begin P0.2.

Final line:

`P0.1 STATIC FOUNDATION: ACCEPTED LOCALLY — ISOLATED DATABASE AND OUTBOUND-NETWORK RUNTIME PROOF STILL REQUIRED`

or

`P0.1 STATIC FOUNDATION: NOT ACCEPTED — <blocker>`

Wait for owner review.

