# P0.1 — Test Isolation Implementation & Evidence (allowlist correction 2026-07-20)

**Branch:** `phase0/authorized-remediation-20260720`
**Work orders:**
- Corrective: `REPLIT_CODER_P0_1_CORRECTIVE_WORK_ORDER_2026-07-20_1784554592116.md`
- Allowlist correction: `REPLIT_CODER_P0_1_FINAL_ENV_ALLOWLIST_CORRECTION_2026-07-20_1784558881955.md`

**Starting SHA for corrective task:** `83c58dd797a13b5607035231a25c180e4b6f4ca4`
**Allowlist-correction start SHA:** `b61c76224fc82e85201e12bf1bc6278a21b23461`

---

## Corrective changes (from original P0.1 work order)

### 1. `artifacts/api-server/package.json`
Changed `"test"` from raw `vitest run --pool=threads` to `tsx src/test-infra/dbTestPreflightRunner.ts` (fail-closed preflight).

| Script | Before | After |
|---|---|---|
| `test` | `vitest run --pool=threads` (RAW — unsafe) | `tsx src/test-infra/dbTestPreflightRunner.ts` (FAIL-CLOSED) |
| `test:unit` | unchanged | unchanged |
| `test:db` | `tsx src/test-infra/dbTestPreflightRunner.ts` | unchanged |

### 2. `artifacts/api-server/src/test-infra/dbTestGuard.ts`
Added 3 new reason codes and 3 new validation steps:
- Step 7: `TEST_RUN_ID` format validation — `TEST_RUN_ID_FORMAT_INVALID`
- Step 9: run ID embedded in DB name — `TEST_RUN_ID_TARGET_MISMATCH`
- Step 11: external-service mock confirmation — `TEST_EXTERNAL_SERVICES_NOT_MOCKED`

### 3. `artifacts/api-server/src/test-infra/vitest.config.unit.ts`
Replaced wildcard `include` + denylist `exclude` with a POSITIVE ALLOWLIST:
```typescript
include: ["src/test-infra/dbTestGuard.test.ts"]
```
No wildcards. No exclusion lists.

---

## Allowlist-correction changes (2026-07-20, this session)

### 4. `artifacts/api-server/src/test-infra/dbTestPreflightRunner.ts`

**Policy changed:** `CLONE_AND_DENYLIST` → `EXPLICIT_ALLOWLIST`

**Before:** `buildIsolatedChildEnv()` iterated all parent env entries and copied everything not in a 14-key denylist. Unknown credentials, preload hooks, and proxy variables survived.

**After:** `buildIsolatedChildEnv()` starts from an **empty object** and copies only keys present in `CHILD_PROCESS_ENV_ALLOWLIST`. All other parent keys are dropped automatically — no denylist needed.

#### Exported `CHILD_PROCESS_ENV_ALLOWLIST` (14 keys, individually justified)

| Key | Justification |
|---|---|
| `PATH` | Locate node/vitest/pnpm executables |
| `HOME` | Node/npm home for package resolution and .npmrc lookup |
| `TMPDIR` | macOS/Linux primary temp dir |
| `TMP` | Cross-platform fallback (Windows, some Linux) |
| `TEMP` | Windows/cross-platform fallback |
| `LANG` | System locale (e.g. `en_US.UTF-8`) |
| `LC_ALL` | Overrides all `LC_*` locale categories |
| `LC_CTYPE` | Character classification and encoding |
| `TZ` | Time-zone for deterministic timestamp-sensitive tests |
| `CI` | Vitest CI mode (compact output, exit on first failure) |
| `TERM` | Terminal type for ANSI/formatting |
| `FORCE_COLOR` | Force colour output even when not a TTY |
| `NO_COLOR` | Disable colour output |

Keys **not** included (explicitly excluded by policy, not by denylist):
- `NODE_OPTIONS`, `NODE_PATH` — preload/module-path injection
- `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES` — library injection
- `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, `GRPC_PROXY`, `http_proxy`, `https_proxy` — proxy routing
- `NPM_CONFIG_PROXY`, `NPM_CONFIG_HTTPS_PROXY` — package-manager proxy
- All credential, token, secret, webhook, API-key, session, cookie, broker, Telegram, INDstocks, mirror, database-path, and metrics-token variables
- All unknown future parent variables (dropped automatically)

#### Generated test-only keys (set explicitly, not inherited)

| Key | Value |
|---|---|
| `NODE_ENV` | `"test"` |
| `DATABASE_URL` | validated `TEST_DATABASE_URL` value |
| `TEST_DATABASE_URL` | validated `TEST_DATABASE_URL` value |
| `TEST_RUN_ID` | validated run ID (from guard-passed parent) |
| `TEST_DB_ISOLATION_CONFIRMED` | `"true"` |
| `TEST_EXTERNAL_SERVICES_MOCKED` | `"true"` |
| + all `EXECUTION_SWITCH_OVERRIDES` entries | see below |

#### Expanded `EXECUTION_SWITCH_OVERRIDES` (7 entries)

| Switch | Forced value | Parser semantics (static inspection 2026-07-20) | Default when absent |
|---|---|---|---|
| `PAPER_TRADING_ENABLED` | `"false"` | TRUTHY/FALSY set; `"false"` → FALSY → disabled | auto-detect via REPLIT_DEPLOYMENT |
| `REPLIT_DEPLOYMENT` | `"0"` | strict `=== "1"`; `"0"` → false at all 7 read sites | undefined → false |
| `INDSTOCKS_ENABLED` | `"0"` | `envFlag()` FALSY set; `"0"` → disabled (default false) | false |
| `CANDLE_WAREHOUSE_ENABLED` | `"0"` | TRUTHY/FALSY set; `"0"` → FALSY → disabled | auto-detect via REPLIT_DEPLOYMENT |
| `OPTION_SNAPSHOT_ENABLED` | `"0"` | TRUTHY/FALSY set; `"0"` → disabled | auto-detect via REPLIT_DEPLOYMENT |
| `REASONING_WRITER_V2_ENABLED` | `"0"` | strict `=== "1"`; `"0"` → false | undefined → false |
| `LIVE_CASH_SWING_ORDER_ENABLED` | `"false"` | TRUTHY set; `"false"` not in TRUTHY → false (disabled) | false |

#### Switches intentionally absent from overrides (provably safe or pure-calculation only)

| Switch | Absent default | Reason for omission |
|---|---|---|
| `PAPER_FO_COSTS_SHADOW_ENABLED` | `true` | Pure shadow/reporting; no external call, no broker action |
| `PAPER_FO_SHADOW_EXITS_ENABLED` | `true` | Pure shadow/reporting; no external call, no broker action |
| `FNO_SIGNAL_HYGIENE_V2` | `true` (blocks bad trades) | Pure signal gate; default ON is the conservative safety choice |
| `SWING_CASH_EXECUTION_MODE` | `"paper_only"` | Safe default; no external call |
| `SWING_SHADOW_DIAG_ENABLED` | `true` | Owner-only diagnostic route; no external call |

#### `PRODUCTION_SECRETS` (expanded from 13 to 23 entries)

Now documents all project-verified secrets for audit traceability. Security no longer depends on this list — the EXPLICIT_ALLOWLIST drops everything not on the allowlist regardless.

Added since corrective task: `KITE_TOKEN_ENC_KEY`, `KITE_TOKEN_ENC_KEY_OLD`, `KITE_TOKEN_ENC_KEY_NEW`, `KITE_MIRROR_URL`, `KITE_MIRROR_ALLOWED_HOSTS`, `METRICS_TOKEN`, `RESEND_API_KEY`, `SENDGRID_API_KEY`, `DEAD_SYMBOL_WEBHOOK_URL`, `ENV_FILE_PATH`.

---

## Test evidence

### Typecheck

| Attempt | Command | Result |
|---|---|---|
| 1 (only) | `pnpm --filter @workspace/api-server run typecheck` (`tsc -p tsconfig.json --noEmit`) | **Exit 0 — clean** |

### Unit test run

| Attempt | Command | Passed | Failed | Skipped | Duration |
|---|---|---|---|---|---|
| 1 (only) | `vitest run --config vitest.config.unit.ts --pool=threads` | **81** | **0** | **0** | ~798 ms |

No DB connection opened. No real secrets read. No real spawn. No network call.

---

## Label status

| Label | Status | Evidence |
|---|---|---|
| `DEFAULT_TEST_FAIL_CLOSED` | PROVED | `"test"` routes through preflight; guard blocks on any failure before spawn |
| `OPERATIONAL_DATABASE_CHILD_LEAK` | PROVED_ABSENT | DATABASE_URL stripped; child receives TEST_DATABASE_URL value only |
| `PURE_UNIT_ALLOWLIST` | PROVED | One-file positive include, no wildcard |
| `CHILD_ENV_POLICY` | **EXPLICIT_ALLOWLIST** | Empty-object start; only CHILD_PROCESS_ENV_ALLOWLIST keys copied |
| `UNKNOWN_SECRET_CHILD_LEAK` | **PROVED_ABSENT_AT_CHILD_ENV_CONSTRUCTION** | Allowlist policy: unknown keys dropped automatically; 100-key property test passes |
| `NODE_PRELOAD_CHILD_RISK` | **PROVED_ABSENT_AT_CHILD_ENV_CONSTRUCTION** | NODE_OPTIONS, NODE_PATH, LD_PRELOAD, DYLD_INSERT_LIBRARIES not on allowlist; confirmed absent in tests 61–64 |
| `PROXY_ENV_CHILD_RISK` | **PROVED_ABSENT_AT_CHILD_ENV_CONSTRUCTION** | No proxy variable is on the allowlist; confirmed absent in tests 65–73 |
| `EXTERNAL_NETWORK_RUNTIME_ISOLATION` | **UNPROVED** | Application modules bypassing env-var gating may still attempt outbound connections |
| `TEST_DATABASE_ISOLATION_RUNTIME_PROOF` | **NOT_RUN_NO_DATABASE_AUTHORITY** | No isolated DB provisioned; runtime SQL proof pending owner provisioning |
