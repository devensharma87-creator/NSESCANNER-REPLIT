# P0.1 — Test Coupling Inventory (allowlist correction 2026-07-20)

**Branch:** `phase0/authorized-remediation-20260720`
**Baseline SHA:** `47611aa6fad3785f02f97280570f025c71fb975a`
**P0.1 partial SHA:** `83c58dd797a13b5607035231a25c180e4b6f4ca4`
**Corrective SHA:** `4769eb345e89e6fd1496f749c5d0772cee383aa7`
**Allowlist-correction start SHA:** `b61c76224fc82e85201e12bf1bc6278a21b23461`
**Work orders:**
- Corrective: `REPLIT_CODER_P0_1_CORRECTIVE_WORK_ORDER_2026-07-20_1784554592116.md`
- Allowlist correction: `REPLIT_CODER_P0_1_FINAL_ENV_ALLOWLIST_CORRECTION_2026-07-20_1784558881955.md`
**Method:** Static grep only — no module execution, no test runs
**Status:** INCOMPLETE — transitive coupling requires full module-graph tracing

---

## Summary counts (api-server only)

| Category | Count | Basis |
|---|---|---|
| Total test files | ~146 | Prior estimate; not re-counted in this task |
| **PURE_UNIT_CONFIRMED** | **1** | `src/test-infra/dbTestGuard.test.ts` only — positive allowlist |
| DB_DIRECT | 51 | Direct `@workspace/db`, `drizzle-orm`, or `pg.Pool` import — static grep |
| DB_TRANSITIVE | 16+ | All `src/routes/__tests__/` — structural inference only |
| EXTERNAL_SERVICE_DIRECT | Not separately counted | Captured in UNKNOWN |
| EXTERNAL_SERVICE_TRANSITIVE | Not classified | Requires full module-graph trace |
| UNKNOWN_REQUIRES_TRACE | 24 | DATABASE_URL ref, Telegram/Kite module names, or live/integration labels |
| Files calling pool.end() | 11 | Static grep |
| INSERT/UPDATE/DELETE/TRUNCATE | 37 | Static grep |
| Migration/schema-ensure tests | 5 | Static grep |
| Live/dev/production-labelled | 37 | Static grep |

A file may appear in multiple categories.

---

## Child environment policy summary

**Policy: EXPLICIT_ALLOWLIST** (changed from CLONE_AND_DENYLIST, 2026-07-20)

### Allowlisted runtime keys (14)
`PATH`, `HOME`, `TMPDIR`, `TMP`, `TEMP`, `LANG`, `LC_ALL`, `LC_CTYPE`, `TZ`, `CI`, `TERM`, `FORCE_COLOR`, `NO_COLOR`

### Internally generated test-only keys (6 + 7 switches = 13)
`NODE_ENV="test"`, `DATABASE_URL=<TEST_DATABASE_URL>`, `TEST_DATABASE_URL=<TEST_DATABASE_URL>`, `TEST_RUN_ID=<validated>`, `TEST_DB_ISOLATION_CONFIRMED="true"`, `TEST_EXTERNAL_SERVICES_MOCKED="true"`, plus all 7 `EXECUTION_SWITCH_OVERRIDES` entries.

### Execution switches forced to disabled values (7)
`PAPER_TRADING_ENABLED="false"`, `REPLIT_DEPLOYMENT="0"`, `INDSTOCKS_ENABLED="0"`, `CANDLE_WAREHOUSE_ENABLED="0"`, `OPTION_SNAPSHOT_ENABLED="0"`, `REASONING_WRITER_V2_ENABLED="0"`, `LIVE_CASH_SWING_ORDER_ENABLED="false"`

### Categories dropped by allowlist (no denylist needed)
- Unknown future credentials — dropped automatically
- `NODE_OPTIONS`, `NODE_PATH` — preload/module injection
- `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES` — library injection
- All proxy variables (uppercase + lowercase + npm variants)
- All 23 named `PRODUCTION_SECRETS`
- All previously-leaked keys: `KITE_TOKEN_ENC_KEY`, `KITE_TOKEN_ENC_KEY_OLD`, `KITE_TOKEN_ENC_KEY_NEW`, `KITE_MIRROR_URL`, `KITE_MIRROR_ALLOWED_HOSTS`, `METRICS_TOKEN`, `RESEND_API_KEY`, `SENDGRID_API_KEY`, `DEAD_SYMBOL_WEBHOOK_URL`, `ENV_FILE_PATH`

---

## Coupling findings (unchanged from corrective task)

### PURE_UNIT_CONFIRMED files (1)

- `src/test-infra/dbTestGuard.test.ts` — imports only vitest + test-infra modules; all connections are dummy/non-routable; no process.env read or mutation; fake spawn only.

### DB_DIRECT category (51 files — sample)

These files import `@workspace/db`, `drizzle-orm`, or construct a `pg.Pool` directly. All require an isolated database. They cannot run under the current test infrastructure until an isolated DB is provisioned.

Sample files:
- `src/routes/__tests__/paper.test.ts`
- `src/routes/__tests__/swingScan.test.ts`
- `src/lib/paperAutoTrade.test.ts`
- `src/lib/heatMonitor.test.ts`
- `src/lib/oiLab.test.ts`
- `src/lib/swingScannerStore.test.ts`
- `src/lib/candleWarehouseIngestor.test.ts`
- `src/lib/optionChainSnapshotIngestor.test.ts`
- `src/lib/fnoSignalAlerts.test.ts` (+ live Telegram risk)
- `src/lib/tradeLifecycle/parityHarness.test.ts` (+ parity Telegram risk)

### EXTERNAL_SERVICE risk (static grep findings)

| Risk | Files | Pattern |
|---|---|---|
| Telegram live send | alerting.ts, telegramBotCommands.ts, fnoSignalAlerts.ts | `TELEGRAM_BOT_TOKEN` real calls in test env |
| Kite API calls | kiteAuth.ts, kiteScanner.ts, kiteFeed.ts | Real HTTP to api.kite.trade |
| INDstocks HTTP | indstocksClient.ts | `INDSTOCKS_API_BASE` fetch |
| Resend/SendGrid email | deadSymbolNotifier.ts | `RESEND_API_KEY`, `SENDGRID_API_KEY` |

All mitigated at configuration level: secrets stripped, switches disabled. Runtime proof pending.

---

## Pending work (not authorized in P0.1)

1. **Owner-provisioned isolated database**: `TEST_DATABASE_URL` pointing to a disposable instance with the correct schema.
2. **Runtime network isolation**: Firewall rules or mock-server layer preventing real outbound HTTP.
3. **DB_DIRECT test suite run**: 51+ files that cannot currently run safely under the guard.
4. **Transitive coupling trace**: Full module-graph analysis for the 24 UNKNOWN_REQUIRES_TRACE files.
5. **Telegram TESTSTK suppression**: `validateTradeEventForNotification` guard confirmed as a memory entry (`teststk-telegram-leak.md`) — still not wired in test context.
