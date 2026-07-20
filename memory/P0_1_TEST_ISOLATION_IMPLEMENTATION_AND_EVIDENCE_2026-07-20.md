# P0.1 — Test Isolation Implementation & Evidence (corrected 2026-07-20)

**Branch:** `phase0/authorized-remediation-20260720`  
**Work order:** REPLIT_CODER_P0_1_CORRECTIVE_WORK_ORDER_2026-07-20_1784554592116.md  
**Starting SHA for corrective task:** `83c58dd797a13b5607035231a25c180e4b6f4ca4`

---

## Corrective changes made

### 1. `artifacts/api-server/package.json`
Changed `"test"` from `vitest run --pool=threads` (raw, unsafe) to `tsx src/test-infra/dbTestPreflightRunner.ts` (fail-closed preflight).

| Script | Before | After |
|---|---|---|
| `test` | `vitest run --pool=threads` (RAW — unsafe) | `tsx src/test-infra/dbTestPreflightRunner.ts` (FAIL-CLOSED) |
| `test:unit` | `vitest run --config vitest.config.unit.ts --pool=threads` | unchanged |
| `test:db` | `tsx src/test-infra/dbTestPreflightRunner.ts` | unchanged |

No raw `vitest run` bypass remains except `test:unit`, which uses the strict positive-allowlist config.

### 2. `artifacts/api-server/src/test-infra/dbTestGuard.ts`
Added 3 new reason codes and 3 new validation steps:
- Step 7: `TEST_RUN_ID` format validation — `TEST_RUN_ID_FORMAT_INVALID`
- Step 9: run ID present in DB name — `TEST_RUN_ID_TARGET_MISMATCH`
- Step 11: external-service mock confirmation — `TEST_EXTERNAL_SERVICES_NOT_MOCKED`

### 3. `artifacts/api-server/src/test-infra/dbTestPreflightRunner.ts`
Added:
- `PRODUCTION_SECRETS` — list of all project-verified secret env var names (static-grep sourced)
- `EXECUTION_SWITCH_OVERRIDES` — project-verified kill switches forced to disabled values
- `buildIsolatedChildEnv()` — exported pure function that builds sanitized child env
- Updated `runPreflightCheck` to pass `buildIsolatedChildEnv(env)` as child env to spawn

### 4. `artifacts/api-server/vitest.config.unit.ts`
Replaced wildcard include + exclusion list with single-file positive allowlist:
```
include: ["src/test-infra/dbTestGuard.test.ts"]
```
No wildcard. No exclusion list. PURE_UNIT_CONFIRMED = 1.

### 5. `artifacts/api-server/src/test-infra/dbTestGuard.test.ts`
- Updated `VALID_ENV`: added `TEST_EXTERNAL_SERVICES_MOCKED: "true"`, changed run ID to `"run-abc123"` and DB name to `"nse_vitest_run-abc123"` (run ID embedded in DB name).
- Updated test 19 (runId assertion) and test 21 (URL to match new VALID_ENV).
- Replaced old tests 25–26 (weak script assertions) with 23 new tests across 7 new describe blocks.
- Total: **47 tests** (24 kept + 23 new).

---

## All reason codes

| Code | Trigger |
|---|---|
| `NOT_TEST_ENV` | `NODE_ENV !== "test"` |
| `TEST_DATABASE_URL_MISSING` | `TEST_DATABASE_URL` absent/empty/non-postgres |
| `OPERATIONAL_DATABASE_FALLBACK_FORBIDDEN` | `TEST_DATABASE_URL` absent, `DATABASE_URL` present |
| `TEST_EQUALS_OPERATIONAL_TARGET` | Canonical host:port/db matches operational URL |
| `TEST_TARGET_NOT_ISOLATED` | DB name contains denylist fragment OR lacks isolation keyword |
| `TEST_RUN_ID_MISSING` | `TEST_RUN_ID` absent or empty after trim |
| `TEST_RUN_ID_FORMAT_INVALID` | `TEST_RUN_ID` fails `/^[A-Za-z0-9_-]{8,64}$/` |
| `TEST_RUN_ID_TARGET_MISMATCH` | DB name does not contain normalized run ID |
| `TEST_DB_CONFIRMATION_MISSING` | `TEST_DB_ISOLATION_CONFIRMED !== "true"` |
| `TEST_EXTERNAL_SERVICES_NOT_MOCKED` | `TEST_EXTERNAL_SERVICES_MOCKED !== "true"` |
| `VALID_ISOLATED_TEST_CONFIGURATION` | All 10 checks pass (success) |

---

## Project-verified secrets stripped from child environment

Source: static grep of `artifacts/api-server/src/` for `process.env["VAR_NAME"]`.

| Env var | Source file(s) |
|---|---|
| `APP_ACCESS_PASSWORD` | `auth.ts`, `kiteAuth.ts` |
| `GLOBAL_APP_ACCESS_PASSWORD` | `global/auth.ts` |
| `SESSION_SECRET` | session config |
| `TRADINGVIEW_WEBHOOK_SECRET` | `systemStatus.ts` |
| `KITE_API_KEY` | `kiteAuth.ts` |
| `KITE_API_SECRET` | `kiteAuth.ts` |
| `TELEGRAM_BOT_TOKEN` | `alerting.ts`, `telegramBotCommands.ts` |
| `TELEGRAM_CHAT_ID` | `alerting.ts`, `telegramBotCommands.ts` |
| `PREPOST_TELEGRAM_BOT_TOKEN` | `alerting.ts` |
| `PREPOST_TELEGRAM_CHAT_ID` | `alerting.ts` |
| `INDSTOCKS_API_TOKEN` | `indstocksClient.ts`, `indstocksTokenStore.ts` |
| `PARITY_TEST_TELEGRAM_BOT_TOKEN` | `tradeLifecycle/parityHarness.ts` |
| `PARITY_TEST_TELEGRAM_CHAT_ID` | `tradeLifecycle/parityHarness.ts` |

`DATABASE_URL` is also removed and replaced with the validated `TEST_DATABASE_URL` value.

---

## Project-verified execution switches forced to disabled

Source: static grep of `artifacts/api-server/src/` for `process.env["SWITCH_NAME"]`.

| Env var | Forced value | Source file(s) |
|---|---|---|
| `PAPER_TRADING_ENABLED` | `"false"` | `paperAutoTradeFlag.ts` |
| `REPLIT_DEPLOYMENT` | `"0"` | `paperAutoTradeFlag.ts`, `candleWarehouseIngestor.ts`, `optionChainSnapshotIngestor.ts` |
| `INDSTOCKS_ENABLED` | `"0"` | `indstocksRouter.ts` (indirectly via policy.ts) |

---

## Child environment key policy

```
NODE_ENV                    = "test"                        (forced)
DATABASE_URL                = <TEST_DATABASE_URL value>     (replaced)
TEST_DATABASE_URL           = <TEST_DATABASE_URL value>     (preserved)
PAPER_TRADING_ENABLED       = "false"                       (forced disabled)
REPLIT_DEPLOYMENT           = "0"                           (forced disabled)
INDSTOCKS_ENABLED           = "0"                           (forced disabled)
APP_ACCESS_PASSWORD         = STRIPPED
GLOBAL_APP_ACCESS_PASSWORD  = STRIPPED
SESSION_SECRET              = STRIPPED
TRADINGVIEW_WEBHOOK_SECRET  = STRIPPED
KITE_API_KEY                = STRIPPED
KITE_API_SECRET             = STRIPPED
TELEGRAM_BOT_TOKEN          = STRIPPED
TELEGRAM_CHAT_ID            = STRIPPED
PREPOST_TELEGRAM_BOT_TOKEN  = STRIPPED
PREPOST_TELEGRAM_CHAT_ID    = STRIPPED
INDSTOCKS_API_TOKEN         = STRIPPED
PARITY_TEST_TELEGRAM_BOT_TOKEN = STRIPPED
PARITY_TEST_TELEGRAM_CHAT_ID   = STRIPPED
PATH, HOME, and other runtime vars = passed through
```

Values and secrets are never logged.

---

## EXTERNAL_NETWORK_RUNTIME_ISOLATION: UNPROVED

Configuration-level isolation is enforced. The child environment has secrets stripped and kill switches set to disabled values. However:
- Application modules that bypass env-var gating (e.g. hardcoded endpoints, cached token variables) may still attempt outbound network connections.
- No outbound network blocking infrastructure (firewall rule, network namespace, mock server binding) is in place.
- `TEST_EXTERNAL_SERVICES_MOCKED=true` is a caller-supplied assertion, not a verified runtime guarantee.

This limitation is acknowledged in the guard's reason text and in the `buildIsolatedChildEnv` JSDoc.

---

## All 47 test names and results

**Command:**
```
cd artifacts/api-server && \
  node_modules/.bin/vitest run --config vitest.config.unit.ts --pool=threads
```

**Result: 47 tests passed, 0 failed, 0 skipped. Duration: ~846 ms.**

| # | Describe | it |
|---|---|---|
| 1 | NOT_TEST_ENV | rejects when NODE_ENV is absent |
| 2 | NOT_TEST_ENV | rejects when NODE_ENV is 'development' |
| 3 | NOT_TEST_ENV | rejects when NODE_ENV is 'production' |
| 4 | TEST_DATABASE_URL_MISSING | rejects when absent and DATABASE_URL also absent |
| 5 | TEST_DATABASE_URL_MISSING | rejects when whitespace and no DATABASE_URL fallback |
| 6 | TEST_DATABASE_URL_MISSING | rejects when not a valid postgres URL |
| 7 | OPERATIONAL_DATABASE_FALLBACK_FORBIDDEN | rejects when TEST_DATABASE_URL absent but DATABASE_URL present |
| 8 | TEST_EQUALS_OPERATIONAL_TARGET | rejects when textually identical |
| 9 | TEST_EQUALS_OPERATIONAL_TARGET — port canonicalization | rejects when implicit/explicit port 5432 same target |
| 10 | TEST_EQUALS_OPERATIONAL_TARGET — hostname case | rejects when PROD-DB.INTERNAL vs prod-db.internal |
| 11 | TEST_DB_CONFIRMATION_MISSING | rejects when TEST_DB_ISOLATION_CONFIRMED absent |
| 12 | TEST_DB_CONFIRMATION_MISSING | rejects when 'false' |
| 13 | TEST_DB_CONFIRMATION_MISSING | rejects when '1' (not 'true') |
| 14 | TEST_RUN_ID_MISSING | rejects when absent |
| 15 | TEST_RUN_ID_MISSING | rejects when whitespace only |
| 16 | TEST_TARGET_NOT_ISOLATED — denylist | rejects when DB name contains 'nse_scanner' |
| 17 | TEST_TARGET_NOT_ISOLATED — denylist | rejects when DB name exactly 'nse_scanner' |
| 18 | TEST_TARGET_NOT_ISOLATED — denylist | rejects when no isolation keyword |
| 19 | VALID_ISOLATED_TEST_CONFIGURATION | accepts structurally valid dummy without connecting |
| 20 | VALID_ISOLATED_TEST_CONFIGURATION | accepts when DATABASE_URL absent (offline CI) |
| 21 | Redacted fingerprint | fingerprint has no password/username/query params |
| 22 | runPreflightCheck — blocks when guard fails | rejects with code when NODE_ENV wrong; spawn not called |
| 23 | runPreflightCheck — blocks when guard fails | rejects when TEST_DATABASE_URL missing; spawn not called |
| 24 | runPreflightCheck — calls spawn sentinel on valid config | invokes spawnFn with vitest args without connecting |
| 25 | TEST_EXTERNAL_SERVICES_NOT_MOCKED | rejects when TEST_EXTERNAL_SERVICES_MOCKED absent |
| 26 | TEST_EXTERNAL_SERVICES_NOT_MOCKED | rejects when TEST_EXTERNAL_SERVICES_MOCKED is '0' |
| 27 | TEST_RUN_ID_FORMAT_INVALID | rejects when fewer than 8 characters |
| 28 | TEST_RUN_ID_FORMAT_INVALID | rejects when contains invalid character (space) |
| 29 | TEST_RUN_ID_FORMAT_INVALID | rejects when more than 64 characters |
| 30 | TEST_RUN_ID_TARGET_MISMATCH | rejects when DB name does not contain normalized run ID |
| 31 | buildIsolatedChildEnv — database URL isolation | child DATABASE_URL equals TEST_DATABASE_URL, not operational URL |
| 32 | buildIsolatedChildEnv — database URL isolation | operational DATABASE_URL value absent from all child entries |
| 33 | buildIsolatedChildEnv — production secrets stripped | all PRODUCTION_SECRETS keys absent from child env |
| 34 | buildIsolatedChildEnv — production secrets stripped | Kite credentials absent from child env values |
| 35 | buildIsolatedChildEnv — production secrets stripped | Telegram and parity tokens absent from child env values |
| 36 | buildIsolatedChildEnv — execution switches forced disabled | PAPER_TRADING_ENABLED forced to 'false' |
| 37 | buildIsolatedChildEnv — execution switches forced disabled | REPLIT_DEPLOYMENT forced to '0' |
| 38 | buildIsolatedChildEnv — execution switches forced disabled | INDSTOCKS_ENABLED forced to '0' |
| 39 | runPreflightCheck — spawn receives isolated child environment | DATABASE_URL=TEST_DATABASE_URL; operational URL absent; PAPER_TRADING_ENABLED disabled |
| 40 | Package-script mandatory preflight enforcement | 'test' routes through dbTestPreflightRunner |
| 41 | Package-script mandatory preflight enforcement | 'test' is not a raw vitest invocation |
| 42 | Package-script mandatory preflight enforcement | 'test:db' routes through dbTestPreflightRunner |
| 43 | Package-script mandatory preflight enforcement | 'test:db' is not a raw vitest invocation |
| 44 | Package-script mandatory preflight enforcement | 'test:unit' uses vitest.config.unit.ts |
| 45 | Package-script mandatory preflight enforcement | no script other than 'test:unit' launches an unguarded vitest run |
| 46 | Positive unit allowlist — strict one-file include | vitest.config.unit.ts include has only guard test; no wildcard |
| 47 | Positive unit allowlist — strict one-file include | vitest.config.unit.ts has no broad exclusion list |

---

## Typecheck result

```
pnpm --filter @workspace/api-server run typecheck
→ tsc -p tsconfig.json --noEmit
→ Exit 0 (clean)
```

---

## Test run history (corrective task, separate from initial P0.1 runs)

| Run | Command | Result |
|---|---|---|
| 1 | `vitest run --config vitest.config.unit.ts --pool=threads` | 47/47 passed — first run, clean |

No failed attempts in the corrective task.

---

## Hard prohibitions confirmed not violated

- ✅ No DB connection opened
- ✅ No existing application tests executed
- ✅ No production source files modified
- ✅ No workflow restart
- ✅ No merge/push/deploy
- ✅ No Kite/Telegram API calls
- ✅ No real environment variables read (all tests use injected objects)
- ✅ `test` and `test:db` not executed (no isolated DB provisioned)

---

## Honest status labels

| Label | Status |
|---|---|
| `DEFAULT_TEST_FAIL_CLOSED` | **PROVED** — `pnpm run test` now routes through preflight; raw bypass removed |
| `OPERATIONAL_DATABASE_CHILD_LEAK` | **PROVED_ABSENT** — configuration-level; `DATABASE_URL` replaced in child env by `buildIsolatedChildEnv`; confirmed by test 31–32 and test 39 |
| `PURE_UNIT_ALLOWLIST` | **PROVED** — positive one-file allowlist; no wildcard; confirmed by tests 46–47 |
| `EXTERNAL_NETWORK_RUNTIME_ISOLATION` | **UNPROVED** — kill switches set in child env; no outbound network block |
| `TEST_DATABASE_ISOLATION_RUNTIME_PROOF` | **NOT_RUN_NO_DATABASE_AUTHORITY** — no isolated DB provisioned |
