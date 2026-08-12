# PHASE 0.6 — CHECKPOINT AND ONE-SHOT SCHEMA-3 DEVELOPMENT PROOF

Bounded checkpoint plus one controlled development-only rebuild attempt.
No deploy, no push, no merge, no subscription change, no production mutation.

**Outcome: the single authorized rebuild was executed and produced a REJECTED manifest.
Nothing was persisted. The blocker is the absence of an authoritative trading calendar.**

---

## A. CHECKPOINT SCOPE — EXACT FILE LIST AND CLASSIFICATION

### A.1 Already checkpointed — commit `14736566` (23 files, retained, history not rewritten)

| Classification | Files |
|---|---|
| **Production** | `artifacts/api-server/src/index.ts`; `src/lib/marketDataHealth.ts`; `src/lib/marketData/aggregateCoverageLive.ts`; `src/lib/registry/{instrumentRegistry,securityClassification,officialSources,universeManifest,manifestStore,coverageBridge}.ts` |
| **Schema** | `lib/db/src/schema/runtimeTables.ts` |
| **Test** | `src/lib/registry/{instrumentRegistry,securityClassification,officialSources,universeManifest,manifestStore}.p06.test.ts`; `src/lib/registry/p06TestFixtures.ts` |
| **Development script** | `artifacts/api-server/scripts/p06.persistGeneration.ts`; `scripts/p06.registryEvidence.ts` |
| **Documentation / memory / directive** | `DATA_FOUNDATION_PHASE_0_6_REPORT.md`; `.agents/memory/MEMORY.md`; `.agents/memory/p06-instrument-registry.md`; `.agents/memory/denominator-commitment-hashing.md`; `attached_assets/Pasted-…INSTRUM_1786527792325.txt` |
| **Unrelated** | **None** |

### A.2 Working tree since that commit — awaiting platform auto-checkpoint

| Classification | Files |
|---|---|
| **Production** | `src/lib/registry/bseReferencePolicy.ts` (new); `src/lib/registry/officialSources.ts`; `src/lib/registry/universeManifest.ts`; `src/lib/registry/coverageBridge.ts` |
| **Schema** | None (manifest schema version is a source constant, already listed under production) |
| **Test** | `src/lib/registry/bseReferencePolicy.p06.test.ts` (new); `p06ClosureGuards.p06.test.ts` (new); `p06TestFixtures.ts`; `instrumentRegistry.p06.test.ts`; `manifestStore.p06.test.ts`; `universeManifest.p06.test.ts` |
| **Development script** | `scripts/p06.persistGeneration.ts` |
| **Documentation / memory / directive** | `DATA_FOUNDATION_PHASE_0_6_REPORT.md`; this file; `.agents/memory/MEMORY.md`; `.agents/memory/bse-reference-authority.md` (new); `.agents/memory/api-server-vitest-pool.md`; the two `attached_assets/…` directive texts |
| **Unrelated** | **None** |

No file outside Phase 0.6 plus inert memory/directive files is included. Nothing was
committed by hand and no history was rewritten.

---

## B. RECORDED BLOCKERS (recorded, not implemented)

### B.1 `AUTHORITATIVE_TRADING_CALENDAR_NOT_IMPLEMENTED`

The application has no authoritative NSE/BSE holiday calendar. `fnoTradingDays.ts` is
weekday-only, and weekday logic cannot prove the latest completed trading session around
exchange holidays.

Consequences, enforced in code rather than asserted:

- Unknown calendar remains fail-closed — `UNKNOWN_TRADING_CALENDAR` is a first-class
  input and returns `INVALID` with `mayAuthorizeNewGeneration = false`.
- No BSE manifest may be `CURRENT_AUTHORITATIVE` while the latest completed session
  cannot be proven.
- Holidays are not inferred anywhere.
- No calendar provider was added in this pass.

### B.2 `LEGACY_NSE_DEFAULTING_CONSUMERS_REQUIRE_MIGRATION`

Preserved in the deferred consumer inventory, unfixed, all eight sites:

1. `src/lib/kiteCandle/kiteCandleStore.ts:298`
2. `src/lib/kiteCandle/kiteCandleStore.ts:578`
3. `src/lib/kiteCandle/kiteCandleStore.ts:817`
4. `src/lib/kiteCandle/fullNseWarehouse.ts:300`
5. `src/lib/paperTradingEq.ts:1495`
6. `src/routes/scanner.ts:561`
7. `artifacts/scanner/src/lib/portfolio/enrich.ts:311`
8. `artifacts/scanner/src/lib/portfolio/enrich.ts:403`

None of them consumes the manifest. Migration belongs to the identity-adoption phase.

---

## C. THE ONE CONTROLLED DEVELOPMENT-ONLY REBUILD

Executed exactly once: `npx tsx scripts/p06.persistGeneration.ts`.

| Step | Evidence |
|---|---|
| 1. `NODE_ENV` | Unset (`NODE_ENV=[unset]`); `REPLIT_DEPLOYMENT` unset |
| 2. Database name + fingerprint | `heliumdb`, user `postgres`, PostgreSQL 16.10, `sha256(host)[0:12] = cac77afa6447`, host suffix `...helium` |
| 3. Not production | Production is `neondb` / `neondb_owner` — different database, different user. Production has **no** `instrument_universe_manifests` table (`registry_table_present = 0`) |
| 4. Before-state | 2 rows: id 1 `P06-3f42eefe83929db0` (schema 1, ACCEPTED, 9702 records), id 4 `P06-c868d08c6ed46d76` (schema 2, ACCEPTED, 9702 records) |
| 5. Source retrieval | **Zero network retrievals.** Reused the existing valid local cache `.cache/p06-sources/` (6 files, retrieved 2026-08-12 09:46–09:47: `EQUITY_L.csv`, `SME_EQUITY_L.csv`, `eq_etfseclist.csv`, `bse_active.json`, `bse_susp.json`, `kite_instruments.csv`). The script performs no network I/O by construction |
| 6. One schema-3 manifest built | `P06-5c9d2180cc43ed25` — schema 3, policy 1, built under the final owner-approved policy |
| 7. Calendar unknown ⇒ no faked authority | BSE authority returned `INVALID`, `mayAuthorizeNewGeneration = false`, reason *"trading calendar unknown: latest completed BSE session cannot be determined"*. Manifest `acceptanceStatus = REJECTED`, 1 blocker. No `CURRENT_AUTHORITATIVE` was fabricated |
| 8. Persist only if every gate passes | The durable write was **refused by the pre-insert validator**: `{"ok":false,"durablyCommitted":false,"reasonCode":"VALIDATION_GATES_FAILED","detail":"manifest acceptanceStatus is REJECTED with 1 blockers"}`. The gate runs before any DDL or DML, so no schema touch and no row was written |
| 9. Cold load via the production loader | `loadLatestAcceptedGeneration()` returned **null**. Both stored rows were rejected with `schema/policy version mismatch` (`schemaVersion: 2`, `policyVersion: 1`), from both the L1 disk layer and PostgreSQL |
| 10. Recompute / verify | The pre-commit validator returned **exactly one** failure — acceptance status. Every other gate therefore verified on the newly built generation: manifest checksum matches its own content, `eligibleLiveSetHash` matches the records, `recordSetHash` (full-record-set commitment) matches the records, record count equals `totalOfficialRecords + indexCount`, schema version = 3, policy version = 1, and no record carries a foreign `registryGenerationId`. Source hashes are the six cached-body hashes carried in `sourceProvenance`; reconciliation is closed on both exchanges (`remainder = 0`, tier `UNRESOLVED = 1` and `EXCLUDED_NON_STOCK = 0`). Generation id is content-derived and includes `schema=3`, which is why it differs from the schema-1/2 ids |
| 11. Schema-1/2 rows preserved | Unchanged: ids 1 and 4, same generation ids, same `record_count = 9702`, same `generated_at`, same 2312 kB |
| 12. Retention removed nothing | `pg_stat_user_tables.n_tup_del = 0` for `instrument_universe_manifests`, and `REGISTRY_DB_MAX_SNAPSHOTS = 3` was never exceeded (peak 2 rows). **Correction to the previous report:** the id gap 1 → 4 is *not* retention pruning — it is identity values consumed by insert attempts that retained no row (sequences are not transactional). Retention has never executed a deletion, and by construction it is scoped to this one table |
| 13. Production untouched | Two read-only `SELECT`s only (identity, `information_schema`). No registry table exists there and none was created. Dev insert counter for the registry table is `n_tup_ins = 2` — i.e. still only the two pre-existing rows |
| 14. Not repeated | The rebuild was run once |

---

## D. COVERAGE-BRIDGE PROOF

No schema-3 result was cold-loadable, because none was persisted. What the run and the
targeted tests do prove:

| Claim | Status | Evidence |
|---|---|---|
| A valid accepted manifest supplies the authoritative denominator | Proven **only in test**, not from a live cold load | `p06ClosureGuards` matrix 12: an accepted, checksum-valid, reconciled generation yields `AUTHORITATIVE_RECONCILED_UNIVERSE`; tampering breaks the checksum |
| An invalid/absent manifest keeps coverage non-authoritative | **Proven live** | Real cold load returned null ⇒ bridge returned `UNIVERSE_NOT_CONFIGURED`, `requiredInstrumentIds = 0`, `universeReconciliationValid = false` |
| ~58-token feed remains `LEGACY_PARTIAL_CONFIGURATION` | Unchanged | `CONFIGURED_UNIVERSE_SCOPE_ID = "LEGACY_CONFIGURED_FEED"`; `aggregateCoverageLive.ts:147` still labels it `LEGACY_PARTIAL_CONFIGURATION`. No file in that path was modified |
| `LIVE_COMPLETE` remains impossible | Unchanged | `LIVE_COMPLETE` requires the completeness branch in `aggregateCoverage.ts:807`, which the legacy scope can never satisfy; no accepted authoritative universe exists to reach it either |
| Manifest existence does not prove subscriptions or fresh ticks | Enforced | `subscriptionRequestedCount = 0` in the live run; matrix 14 asserts it stays 0 even for a full required set |
| Provider conflict remains `NOT_CHECKED` | Enforced | Every record is `NOT_CHECKED`; nothing in the registry performs a provider call (source-text guard: no `subscribe(`, `setMode(`, `KiteTicker`, `startTicker`) |
| No subscription count changes | Confirmed | `NIFTY50_SYMBOLS` length **50** + `subscribeIndices()` (~8 index tokens) ≈ **58**, before and after. `git status` shows no change to `kiteFeed.ts` or `watchlistLists.ts` |
| No scores, signals or orders consume the manifest | Confirmed | Exactly two importers of `src/lib/registry/` exist: `src/index.ts:79` (startup restore) and `src/lib/marketDataHealth.ts:32-33` (coverage denominator) |

---

## E. VERIFICATION PERFORMED

- One targeted execution of the persistence/load script (build → gate → cold load → bridge).
- `git diff --check` — clean.
- No source file was modified in this pass, so the previously green targeted runs
  (`src/lib/registry/` 7 files / 148 tests; `src/lib/marketData/` + `src/lib/health`
  21 files / 375 tests; `tsc --noEmit` clean) still describe the current tree. Re-running
  them unchanged would not have changed the result.
- No broad package suites, builds, browsers or benchmarks.

---

## F. REQUIRED FINAL EVIDENCE

1. **Checkpoint SHA and files** — `14736566` (23 files, section A.1), retained, history
   intact. HEAD is still `14736566` on `pack33c-p1-1-isolated`; the section A.2 working
   tree is uncommitted and awaiting platform auto-checkpoint. `main` remains `e37a4a32`.
2. **Development database identity** — `heliumdb`, user `postgres`, PostgreSQL 16.10,
   host fingerprint `cac77afa6447`, `NODE_ENV` unset, `REPLIT_DEPLOYMENT` unset.
3. **Before/after registry rows** — before: 2 rows (ids 1, 4 — `P06-3f42eefe83929db0`
   schema 1, `P06-c868d08c6ed46d76` schema 2). After: **identical**. No row added,
   modified or removed.
4. **Official-source retrieval count** — **0**. Existing valid local cache reused.
5. **Schema-3 generation ID** — `P06-5c9d2180cc43ed25` (built, not persisted).
6. **Record / tier / mapped counts** — 9,493 official records + 209 indices = 9,702 total;
   tiers `LIVE_REQUIRED 7880`, `SNAPSHOT_ONLY 599`, `UNAVAILABLE 1222`,
   `EXCLUDED_NON_STOCK 0`, `UNRESOLVED 1`. `firstSeenAt` set on **0 / 9493** — history
   carry-forward is currently broken *because* the schema-3 loader correctly rejects the
   schema-1/2 rows; it will repopulate on the first accepted schema-3 generation.
7. **Checksum and record-commitment equality** — both verified on the built generation:
   the pre-commit validator's only failure was acceptance status, so checksum,
   `eligibleLiveSetHash`, `recordSetHash` and the record-count identity all matched.
8. **Cold-load result** — `loadLatestAcceptedGeneration()` = **null**; both stored rows
   rejected for schema/policy version mismatch (schema 2 vs required 3), from L1 disk and
   from PostgreSQL.
9. **Coverage-bridge result** — `UNIVERSE_NOT_CONFIGURED`; required ids 0; subscriptions
   requested 0; reconciliation valid false. Correct fail-closed behaviour.
10. **Production non-mutation** — `neondb` / `neondb_owner`;
    `registry_table_present = 0`; read-only `SELECT`s only; no deployment.
11. **Subscription count** — 50 configured equities + ~8 index tokens ≈ **58** before and
    after; subscription path files untouched.
12. **Four frozen safety constants** — all `false as boolean`:
    `FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED` (`candleEvaluationControl.ts:44`),
    `SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED` (`candleEvaluationControl.ts`),
    `FNO_PAPER_V2_RUNTIME_AUTHORIZED` (`v2PaperLocks.ts:39`),
    `SWING_PAPER_V2_RUNTIME_AUTHORIZED` (`v2PaperLocks.ts:40`).
13. **Deferred blockers** — `AUTHORITATIVE_TRADING_CALENDAR_NOT_IMPLEMENTED` and
    `LEGACY_NSE_DEFAULTING_CONSUMERS_REQUIRE_MIGRATION` (eight sites, section B).
    Also still open: BSE UDiFF retrieval does not exist; boot-time restore never
    runtime-verified; four Phase 0.5C blockers; the aggregate LIVE-status blocker.
14. **Git status** — HEAD `14736566`; 11 modified + 6 untracked files, all in section A.2,
    all Phase 0.6 or inert; nothing pushed, merged or deployed; `git diff --check` clean.
15. **Cost and execution accounting** — zero network egress, zero provider quota, zero
    database writes, no builds, no restarts, no broad suites. One script execution
    (~10 MB of cached source parsed), a handful of read-only SQL statements, and one
    correction to a previously reported claim (retention, section C.12).

---

## VERDICT

**PHASE_0_6_BLOCKED — AUTHORITATIVE_TRADING_CALENDAR_REQUIRED**

The single authorized schema-3 rebuild ran to completion on real cached official sources
and produced a structurally sound generation — 9,702 records, closed reconciliation,
every hash and commitment verified — that the owner-approved BSE reference policy refused
to authorize, because the latest completed trading session cannot be proven without an
authoritative calendar. The pre-insert gate then refused the write. Nothing was persisted,
nothing was deployed, no subscription changed, and production was neither reached nor
mutated.

Clearing this requires an authoritative NSE/BSE trading calendar and BSE UDiFF retrieval.
Both are next-phase work and neither may be approximated with weekday assumptions.
