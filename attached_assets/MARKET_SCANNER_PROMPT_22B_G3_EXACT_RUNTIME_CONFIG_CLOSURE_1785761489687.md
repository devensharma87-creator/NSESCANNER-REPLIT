# MARKET SCANNER — PROMPT 22B

## Gate G3 Exact Runtime Configuration Closure

### Instruction to the Replit coder

Preserve the Prompt 22A results:

```text
Prompt 22A targeted tests: 126/126
api-server: 5,243/5,243
scanner: 947/947
five package typechecks: clean
scanner/global fake-sentinel bundle matches: zero
```

Do not reopen Gates G1, G2 or G4–G7.

One blocker remains:

```text
G3_RUNTIME_REJECTION_NOT_PROVEN
```

The child-process probe exited because an unrelated ESM `__dirname` error occurred while importing routes. It did not reach the production CORS/session-secret guard. Replacing the exact error assertion with “non-zero exit + source guard exists” does not prove runtime rejection.

This prompt authorizes only the exact G3 correction and the minimum verification required after it.

No manual commit, push, pull, fetch, publish or deployment is authorized.

Do not connect to PostgreSQL, run `.db.test.ts`, contact live providers/Telegram/brokers, expose credentials or change trading behavior.

---

# 1. Objective

Make production configuration validation independently executable, ensure the real server bootstrap invokes it before importing/initializing routes, and prove exact failure reasons for invalid production configuration.

Do not accept a generic non-zero exit. Do not accept an unrelated module/import failure. Do not replace runtime behavior with source inspection.

---

# 2. Required production boundary

## 2.1 Pure deterministic validator

Identify or extract one side-effect-free production function equivalent to:

```ts
validateProductionConfig(env): ConfigValidationResult
```

It must:

- accept an explicit environment/config object;
- not read the operational database;
- not start HTTP listeners;
- not import registered routes, schedulers, providers or browser bundles;
- not contact external services;
- return or throw stable machine-readable error codes;
- never include secret values in returned messages or logs;
- be the same validator used by the real production bootstrap.

Do not create a second test-only copy of configuration rules.

## 2.2 Bootstrap ordering

The actual production server entry point must validate configuration before route/scheduler/provider initialization.

Required order:

```text
read explicit production environment
→ validate production configuration
→ if invalid: emit sanitized stable code and exit before listening
→ if valid: import/create application
→ register/start server and allowed schedulers
```

If static imports currently initialize the app before the validator runs, make the smallest safe bootstrap correction, such as validating before a dynamic app import.

Do not broadly refactor the server.

## 2.3 Stable error codes

Use existing stable codes if present. Otherwise introduce narrowly scoped codes equivalent to:

```text
PROD_CONFIG_INVALID:CORS_WILDCARD
PROD_CONFIG_INVALID:SESSION_SECRET_MISSING
PROD_CONFIG_INVALID:SESSION_SECRET_WEAK
PROD_CONFIG_INVALID:TOKEN_ENCRYPTION_KEY_MISSING
PROD_CONFIG_INVALID:TOKEN_ENCRYPTION_KEY_MALFORMED
```

Only enforce requirements already owned by production policy. Do not invent a new mandatory secret solely for the test.

Error output may include secret names and safe reasons; it must never include secret values.

---

# 3. Exact child-process runtime probes

Use an isolated child process with an explicit allowlisted fake environment.

Do not inherit Replit secret values through an unrestricted `{...process.env}` spread. Include only required non-secret process basics such as executable path/PATH plus test-controlled fake values.

Use unique fake sentinels—not real credentials.

## 3.1 CORS wildcard rejection

Configuration:

```text
NODE_ENV=production
CORS_ORIGINS=*
SESSION_SECRET=<strong fake sentinel>
all other policy-required fields=<valid fake sentinels>
```

Required result:

- child exits non-zero;
- stdout/stderr contains the exact safe CORS-wildcard error code;
- output does not contain any fake secret value;
- output does not contain `__dirname is not defined`;
- route/app initialization marker remains zero/not reached;
- listener is never opened.

## 3.2 Missing session-secret rejection

Configuration:

```text
NODE_ENV=production
CORS_ORIGINS=https://example.invalid
SESSION_SECRET absent
all other policy-required fields=<valid fake sentinels>
```

Required result:

- child exits non-zero;
- output contains the exact missing-session-secret error code;
- output does not contain any secret value;
- output does not contain the CORS error code;
- output does not contain an unrelated ESM/import error;
- app/routes/listener are not initialized.

## 3.3 Independent rule ordering

When both `CORS_ORIGINS=*` and `SESSION_SECRET` are invalid, prove the validator returns the documented deterministic first error or structured list of both errors. Document the policy.

## 3.4 Valid production configuration

Configuration:

```text
NODE_ENV=production
CORS_ORIGINS=https://example.invalid
SESSION_SECRET=<strong fake sentinel>
other required values=<valid fake sentinels>
```

Invoke the production validator/bootstrap in a no-listen test mode or through an injected listener factory.

Required result:

- validator succeeds;
- child emits an exact `CONFIG_VALID`/bootstrap-validation marker;
- no secret value appears in output;
- no external service, database, route request or live listener is used;
- test ends cleanly without an ESM `__dirname` error.

## 3.5 Actual bootstrap hook

Prove the real server bootstrap—not merely the validator module—calls this validator before app initialization.

Use executable dependency injection/spies or a no-listen bootstrap mode. Source order may supplement the runtime assertion but cannot replace it.

---

# 4. Required tests

Update the existing Prompt 22A config test file or add one narrowly named Prompt 22B file.

At minimum prove:

1. validator is the real production validator;
2. CORS wildcard returns the exact CORS code;
3. missing session secret returns the exact session code;
4. invalid rules cannot pass because of unrelated process failure;
5. output contains no fake secret values;
6. valid fake production configuration succeeds;
7. validation precedes app/route initialization;
8. no HTTP listener is opened;
9. no scheduler starts;
10. no database/provider/Telegram/broker transport is called;
11. unrelated ESM `__dirname` errors are explicitly forbidden in probe output;
12. existing G3 source assertions remain supplementary only.

Do not broaden expected errors to `/CORS|SESSION|__dirname|error/i`.

Each negative test must assert its exact intended code and explicitly reject unrelated import/runtime errors.

---

# 5. Verification

Run:

- the exact Prompt 22B/G3 targeted test;
- all six Prompt 22A files;
- full API-server non-DB suite;
- API-server TypeScript;
- API Zod TypeScript if shared config/schema was touched;
- API client React, Scanner and Global typechecks if shared code was touched;
- API-server production build;
- Scanner production build;
- Global/web production build;
- `git diff --check`.

Preserve at minimum:

```text
Prompt 22A: 126/126
api-server: 5,243 passing / 0 failing
scanner: 947 passing / 0 failing
```

New G3 tests should increase the API-server total. Reconcile the exact increase.

Do not execute DB-only suites.

Prove no new:

- `.skip`, `.only`, retries or quarantine;
- arbitrary sleeps;
- source-only substitution for runtime proof;
- accepted unrelated exit failure;
- live network/database/broker calls;
- secret value in output, bundles or evidence;
- unrelated production changes.

---

# 6. Evidence correction

Update the existing file only:

```text
artifacts/audit-evidence/FAST_TRACK_PACK_4_FINAL_HARDENING_AND_RELEASE_READINESS.md
```

Correct the previous G3 claim explicitly:

```text
Previous probe invalid: exited before configuration guard because of ESM __dirname failure.
Source proof was supplementary and did not satisfy runtime rejection.
```

Then record:

- exact validator/bootstrap production change;
- exact child environment policy with values redacted;
- exact exit codes and safe error codes;
- explicit absence of unrelated ESM errors;
- proof app/routes/listener were not initialized on invalid config;
- valid-config no-listen result;
- test/typecheck/build results;
- exact changed-file inventory;
- starting/final observed HEAD and working-tree state;
- confirmation of no commit/push/deploy/DB/live external action;
- final SHA-256.

The final nonblank line must be exactly:

```text
END_FAST_TRACK_PACK_4_G3_EXACT_RUNTIME_CONFIG_CLOSURE
```

It must occur exactly once.

Update the owner runbook only if the exact production config requirements or error codes changed. Do not rewrite unrelated sections.

---

# 7. Final response

Return a concise report containing:

1. Verdict.
2. Previous G3 false-positive explanation.
3. Production validator/bootstrap change.
4. Exact CORS runtime result.
5. Exact session-secret runtime result.
6. Valid-config/no-listen result.
7. Secret-output and external-call result.
8. Targeted/full test totals.
9. Typecheck/build results.
10. Git/evidence integrity.
11. Remaining owner actions.
12. Production status.

The only successful verdict is:

```text
ACCEPT_FAST_TRACK_PACK_4_FINAL_HARDENING_RUNTIME_VERIFIED_FINAL
```

Use it only when G3 is proved by the exact production runtime boundary and no child probe exits because of an unrelated import/module error.

On success report:

```text
CODEBASE_READY_FOR_OWNER_DEPLOYMENT_DECISION
PROVIDER_ACTIVATION_PENDING
PROFESSIONAL_UI_REFINEMENT_PENDING
PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED
```

If G3 cannot be executed before app imports without a broader bootstrap change, return:

```text
BLOCKED_FAST_TRACK_PACK_4_G3_BOOTSTRAP_ORDER
```

with the exact import/order limitation and smallest safe correction. Do not claim acceptance from a generic non-zero exit.

Do not deploy, publish, push or begin provider/UI work. Stop for the next owner instruction.
