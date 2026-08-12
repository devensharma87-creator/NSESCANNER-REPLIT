# DATA FOUNDATION PHASE 0.6 — FINAL CLOSURE REPORT

Closure of the two declared blockers (owner-approved BSE reference policy, complete
consumer classification) plus the development-database boundary proof.

Scope discipline: no source downloads, no provider calls, no service restarts, no
database writes, no deployment, no subscription change, no full-suite runs.

---

## 1. BSE POLICY IMPLEMENTATION

New module: `artifacts/api-server/src/lib/registry/bseReferencePolicy.ts` (293 lines,
pure — no I/O, no clock, no provider call, no DB). Every input, including "what IST day
is it" and "what was the last completed session", is supplied by the caller, so an
unknown calendar is *representable* and therefore fails closed instead of being guessed.

States: `CURRENT_AUTHORITATIVE`, `LAST_KNOWN`, `STALE`, `INVALID`, `UNAVAILABLE`.

| Owner rule | Implementation |
|---|---|
| 1. Current-IST-day List of Scrips | `istDateString(list.retrievedAtMs) === istDateString(nowMs)`; otherwise `LAST_KNOWN` (prior exists) or `STALE` |
| 2. Reconciled to newest completed-session UDiFF | `udiff.tradingDate` must equal `calendar.latestCompletedSessionDate`; `udiff === null` ⇒ `LAST_KNOWN`/`UNAVAILABLE` |
| 3. Weekends / exchange holidays | No special branch is needed and none was added: `latestCompletedSessionDate` already names the last real session, so a weekend authorizes on identical terms. `dayKind` is recorded for evidence |
| 4. Failed current-day retrieval | `RETRIEVAL_FAILED` ⇒ `LAST_KNOWN` when a prior accepted generation exists, else `UNAVAILABLE`. Never authorizes |
| 5. Valid through pre-open and market hours | Authority is compared against the latest **completed** session, never against wall-clock; only a *newer completed* session makes the held file `STALE` |
| 6. Fail closed | Unknown calendar, non-`ACCEPTED` List/UDiFF validation (covers malformed body, empty body, row-floor breach and hash failure, which `officialSources` already folds into `SourceValidationResult`), in-progress session, malformed date, **impossible-but-well-formed date** (`isRealIstDate` round-trips through the calendar, so `2026-02-31` is rejected rather than sorting like a real February date), future date, post-dated file, and unclosed reconciliation each return a denial. Both the UDiFF trading date and the calendar's completed-session date are validated **before** any ordering comparison |
| 7. `LAST_KNOWN` cannot mutate membership | `detectLastKnownMutation()` diffs prior vs next by `authoritativeSecurityId` and reports additions, removals, reclassifications and re-tiering |
| 8. Preserve/expose evidence | Result carries `listRetrievedAt`, `effectiveTradingDate`, `listContentHash`, `udiffContentHash`, `udiffTradingDate`, `evaluatedIstDate`, `calendarKnown`, `dayKind`, `state`, `reasons`; result object is frozen |
| 9. Reference identity only | The policy is consumed only by manifest acceptance; nothing in the module can mark a quote LIVE (guard test asserts no `subscribe(`/`setMode(`/`KiteTicker` anywhere in the registry) |
| 10. NSE 48-hour policy unaltered | `NSE_REFERENCE_MAX_AGE_HOURS_MIRROR = 48` untouched; a boundary test pins 47.9 h ⇒ authoritative, 48.1 h ⇒ stale |

**No new hour threshold exists.** The arbitrary `BSE_SAME_RUN_TOLERANCE_MS = 15 min` was
**deleted**. `computeFreshnessState` now labels BSE by IST calendar-day identity. A
source-text guard test fails the build if `MAX_AGE`, `_HOURS`, `TOLERANCE`, `3600_000`,
`86_400` or `ageMs` ever reappears in the policy module (the IST offset constant is the
single, explicitly-excluded exception, and it is timezone arithmetic, not a bound).

Wiring: `BuildManifestInput.bseAuthority` is **required and has no default**, so a caller
that has not evaluated BSE authority cannot mint an accepted manifest by omission.

The verdict is never taken on trust — `mayAuthorizeNewGeneration` is only a boolean on an
object, and `readonly` proves nothing at runtime. Manifest Gate 4 therefore applies three
checks, and the coverage bridge independently re-applies the durable two:

1. **Provenance.** The verdict must be one this process's evaluator actually issued
   (module-private `WeakSet`; a hand-built `{ state: "CURRENT_AUTHORITATIVE",
   mayAuthorizeNewGeneration: true }` object is rejected).
2. **Binding.** `listContentHash` must equal the `BSE_LIST_OF_SCRIPS_ACTIVE` content hash
   in *this* manifest's own source provenance, so a genuine verdict computed over some
   other body cannot be transplanted onto this generation.
3. **Authorization.** `mayAuthorizeNewGeneration` must be true.

The full authority record is stored *inside* the manifest, so `manifestChecksum` covers
it. Object identity cannot survive storage, so `coverageBridge` re-verifies the state and
the hash binding on load — an authority block edited to claim authorization and then
re-signed still fails.

`MANIFEST_SCHEMA_VERSION` 2 → 3 (the manifest shape changed).

---

## 2. POLICY TEST MATRIX

All 16 directive items, `artifacts/api-server/src/lib/registry/`:
`bseReferencePolicy.p06.test.ts` (items 1–11) and `p06ClosureGuards.p06.test.ts` (12–16).

| # | Requirement | Result |
|---|---|---|
| 1 | Current-day List + latest completed-session UDiFF ⇒ `CURRENT_AUTHORITATIVE` | PASS (+ evidence-field and frozen-result assertions) |
| 2 | Weekend / exchange-holiday policy | PASS (Saturday and holiday both authorize from the last completed session) |
| 3 | Pre-open latest-completed-session | PASS (09:00 IST) |
| 4 | Market-hours latest-completed-session | PASS (12:00 IST); `STALE` only once a newer completed session exists |
| 5 | Failed current-day retrieval ⇒ no new authoritative generation | PASS (exhaustive over prior-generation present/absent) |
| 6 | Previous accepted manifest remains `LAST_KNOWN` | PASS (retrieval failure and previous-IST-day retrieval) |
| 7 | Unknown calendar fails closed | PASS (unknown calendar, and "known" with no completed session) |
| 8 | Future / invalid UDiFF date fails closed | PASS (future, malformed, **impossible calendar date `2026-02-31`**, impossible calendar-supplied session date, future completed-session date, post-dating latest session, in-progress session, absent file) |
| 9 | Reconciliation / hash / row-floor failure fails closed | PASS (all four `SourceValidationResult` rejections × List and UDiFF, plus unclosed reconciliation, plus a 9-case sweep asserting only `CURRENT_AUTHORITATIVE` ever authorizes) |
| 10 | `LAST_KNOWN` cannot mutate membership/classification | PASS (add, remove, reclassify, re-tier, unchanged, and non-`LAST_KNOWN` is unconstrained) |
| 11 | NSE 48-hour policy unchanged | PASS (constant, boundary behaviour, BSE calendar-day behaviour, source-text no-threshold guard) |
| 12 | Accepted manifest may supply the coverage denominator | PASS (`AUTHORITATIVE_RECONCILED_UNIVERSE`, and tampering with the authority block breaks the checksum) |
| 13 | Missing/invalid manifest keeps coverage non-authoritative | PASS (null generation, BSE-rejected manifest, older schema version re-signed, **hand-forged authority verdict**, **genuine verdict transplanted from another List body**, **stored verdict whose hash no longer binds its provenance**, **stored verdict edited to claim authorization and re-signed**) |
| 14 | Manifest does not prove subscription/tick completeness | PASS (`subscriptionRequestedCount === 0` with a full required set; every record `NOT_CHECKED`) |
| 15 | ~58-token subscription count unchanged | PASS (50 configured equities pinned; registry proven free of any feed call) |
| 16 | Four safety locks false | PASS (source-text, all four) |

Run: **7 files / 148 tests PASS** (`src/lib/registry/`, `--pool=threads`, ~1 s).

Because the manifest shape changed, the two directly-affected consumer areas were also
re-run rather than assumed: `src/lib/marketData/` + `src/lib/health` — **21 files /
375 tests PASS**. No full package suite was run.

---

## 3. EXACT MANIFEST CONSUMERS TODAY

Repo-wide search for imports of `src/lib/registry/` outside the registry itself returns
**exactly two production call sites**:

| # | Site | What it does |
|---|---|---|
| 1 | `artifacts/api-server/src/index.ts:79` | Startup only. Dynamic `import()` of `loadLatestAcceptedGeneration`, detached and non-fatal, to restore the last accepted generation into memory |
| 2 | `artifacts/api-server/src/lib/marketDataHealth.ts:32-33` | `toAuthoritativeCoverageManifest` + `getActiveGeneration`, used **solely** to supply the coverage *denominator* in health reporting |

Nothing else reads the registry. No order, signal, score, scanner, watchlist, portfolio,
chart, replay or subscription path imports it.

---

## 4. COMPLETE CONSUMER INVENTORY

Legend for "affects": Q=quotes, C=coverage, S=scores, G=signals, O=orders.

| Category | File / module | Data consumed | Current authority | Migrated in 0.6 | Compat adapter | Deferred | Unsafe blocker | Affects | Required future phase |
|---|---|---|---|---|---|---|---|---|---|
| Accepted registry manifest | `src/index.ts:79` | Last accepted generation (startup restore) | Registry (accepted only) | Yes | None | No | None — detached, non-fatal, no downstream read | C only | — |
| Accepted registry manifest | `src/lib/marketDataHealth.ts:32-33` | Manifest + records ⇒ coverage denominator | Registry (accepted only) | Yes | None | No | None — bridge fails closed | C | — |
| Registry bridge | `src/lib/registry/coverageBridge.ts` | Generation ⇒ `AuthoritativeCoverageManifest` | Registry | Yes | N/A (is the bridge) | No | None — re-applies every gate independently | C | — |
| Authoritative universe identities | `src/lib/registry/instrumentRegistry.ts` | Official NSE/BSE/Kite rows | Registry | Yes | None | Downstream adoption deferred | None — no downstream consumer exists yet | none | 0.7 identity adoption |
| canonicalInstrumentId | `src/lib/kiteFeed.ts` (`safeCanonicalId`) | Exchange+segment+symbol | Live feed (independent implementation) | **No** | None — two implementations coexist | Yes | Divergence risk between feed identity and registry identity; not currently wrong, but unreconciled | Q C G O | 0.7 single canonical identity source |
| Provider token lookup | `src/lib/kiteFeed.ts` (`getInstrumentToken`) | Kite instrument master | Kite provider master | No | None | Yes | None today; registry holds richer mapping but is not consulted | Q G O | 0.7 |
| Symbol lookup | `src/lib/kiteFeed.ts`, `src/lib/watchlistLists.ts` | Bare trading symbols | Static lists + provider master | No | None | Yes | **Symbol-only lookup must never authorize live data** — currently enforced by the trust-tier guard in market-data, not by the registry | Q G | 0.7 |
| NSE/BSE master classification | `src/lib/registry/securityClassification.ts` (new) vs legacy `instrument_map` / `global_instruments` tables | Series/group/segment ⇒ class + tier | Registry (new) / legacy tables (in use) | New path only | None | Legacy retirement deferred | None — the two do not interact | none (new) / C S (legacy) | 0.7 legacy retirement |
| Scanner universe | `src/routes/scanner.ts`, `src/lib/fullNseScanner.ts`, `src/lib/watchlistLists.ts` | Static symbol lists | Static configuration | **No — deliberately not expanded** | None | Yes | None; universe is honestly reported as partial | S G | 0.8 scanner universe migration |
| Subscription configuration | `src/lib/kiteFeed.ts:250-275` + `subscribeIndices()` | `NIFTY50_SYMBOLS` + Kite index identity map | Static configuration | **No — unchanged by this phase** | None | Yes | None | Q C G O | 0.8 subscription sharding (requires capacity decision) |
| Coverage denominator | `src/lib/marketData/aggregateCoverageLive.ts` | Configured feed scope | `LEGACY_CONFIGURED_FEED` (explicitly non-authoritative) + registry manifest when accepted | Partially (registry may now supply it) | Two-denominator model already in place | No | None — legacy scope self-declares invalid reconciliation | C | — |
| Watchlist | `src/lib/watchlist.ts`, `src/lib/watchlistBasket.ts`, `src/lib/watchlistLists.ts` | Symbols, central router quotes | Central router (Kite) | No | None | Yes | None — already routes through the trusted layer | Q S | 0.8 |
| Portfolio | `src/routes/portfolio.ts`, `artifacts/scanner/src/lib/portfolio/enrich.ts` | Holdings, quotes, enrichment | Central router + provider | No | None | Yes | Exchange defaulting at `enrich.ts:311,403` (see below) | Q S | 0.7 exchange-default removal |
| Chart resolution | `src/routes/chart.ts` | Curated + Kite master merge | Kite master (documented, symbol-deduped) | No | Existing merge is the compat adapter | Yes | None — quote source is surfaced | Q | 0.8 |
| Replay identity | `src/lib/replayRecorder.ts` | Recorded event identity | Recorder-local | No | None | Yes | Canonical identity fields still missing (open 0.5C blocker, unchanged) | none (replay only) | 0.5C follow-up |
| F&O / Swing admission | `src/lib/optionSignals.ts`, `src/lib/swingCash*.ts`, `src/lib/paperTradingEq.ts` | Instruments, quotes, gates | Central router + existing trust gates | No | None | Yes | Exchange defaulting at `paperTradingEq.ts:1495` (see below) | G O | 0.7 |

### Exchange-defaulting sites (binding rule: "no consumer may silently default to NSE")

These are **pre-existing** and unchanged by Phase 0.6; none of them consumes the manifest.
They are recorded here because the inventory must not omit a direct master/resolver path:

- `src/lib/kiteCandle/kiteCandleStore.ts:298, 578, 817`
- `src/lib/kiteCandle/fullNseWarehouse.ts:300`
- `src/lib/paperTradingEq.ts:1495`
- `src/routes/scanner.ts:561`
- `artifacts/scanner/src/lib/portfolio/enrich.ts:311, 403`

Required future phase: 0.7 exchange-default removal, driven by registry identity.
Fixing them now would be exactly the broadening this pass forbids.

---

## 5. RESOLUTION OF THE BRIDGE-AUTHORITY CONTRADICTION

Both statements in the prior report were true and describe different things; the report
failed to distinguish them.

- **The bridge is implemented and is live.** `marketDataHealth.ts` calls it on every
  health computation. It is a real, executing consumer.
- **Nothing treats the registry as *universe* authority.** The bridge's only output is a
  **coverage denominator** — the set of instruments coverage *should* cover. It cannot
  reach quotes, scores, signals or orders; no code path exists from it to any of them.

So: the manifest today answers exactly one question — *"what is the honest denominator
for coverage reporting?"* — and answers it only when a fully accepted, current-schema,
current-policy, checksum-verified, hash-committed generation exists. Everything in
section 4 marked "deferred" still resolves instruments the way it did before this phase.

The bridge is also where BSE authority is re-checked after storage: an accepted manifest
whose stored verdict is not `CURRENT_AUTHORITATIVE`, or whose `listContentHash` no longer
matches the manifest's own BSE List provenance, yields `UNIVERSE_NOT_CONFIGURED`.

**No consumer can read the manifest as proof of complete live coverage.** Enforced, not
asserted: `subscriptionRequestedCount` is 0, every record is `NOT_CHECKED` against a
provider, the coverage model keeps two separate denominators, and the registry contains
no feed call at all (source-text guard). Therefore `UNSAFE_MANIFEST_CONSUMER` does not apply.

---

## 6. DEVELOPMENT DATABASE ENVIRONMENT PROOF

Read-only evidence for the writes performed in the *previous* pass.

| Item | Evidence |
|---|---|
| NODE_ENV used | Unset in the workspace shell (`NODE_ENV=[unset]`), and `REPLIT_DEPLOYMENT=[unset]`. The workspace is by definition the development environment; no deployment context existed |
| Database name | `heliumdb` (confirmed by `SELECT current_database()` **and** by the `DATABASE_URL` path component) |
| Redacted database fingerprint | `sha256(host)[0:12] = cac77afa6447`; host suffix `...helium`; user `postgres`; PostgreSQL 16.10 |
| Production identity, for contrast | `neondb`, user `neondb_owner` — a **different database and a different user**. Exclusion of production identity is therefore total, not inferential |
| Table name | `instrument_universe_manifests` (the only table involved) |
| Inserted generation IDs | `P06-3f42eefe83929db0` (schema 1), `P06-c868d08c6ed46d76` (schema 2) |
| Inserted row/snapshot count | 2 snapshot rows, ids 1 and 4. Each carries `record_count = 9702` (9,493 official + 209 index records) |
| Before/after table counts | Before: table did not exist (created by the runtime `CREATE TABLE IF NOT EXISTS` ensure). After: 2 rows, 2,312 kB total relation size |
| Retention effect | **None — corrected 2026-08-12.** An earlier draft attributed the id gap 1 → 4 to retention pruning. `pg_stat_user_tables` shows `n_tup_del = 0` for this table, and `REGISTRY_DB_MAX_SNAPSHOTS = 3` was never exceeded (peak 2 rows), so the retention `DELETE` has never removed a committed row. Ids 2 and 3 are identity values consumed by insert attempts that did not retain a row; a sequence is not transactional. The bounded retention path remains unexercised |
| No unrelated table written | The entire write surface of the phase is three statements in `manifestStore.ts` (`CREATE TABLE IF NOT EXISTS` :93, `INSERT` :210, retention `DELETE` :234), all against `instrument_universe_manifests`. Grep of every registry module and both `p06.*` scripts for `INSERT`/`UPDATE`/`DELETE`/`ALTER`/`DROP`/`CREATE TABLE`/drizzle `.insert(`/`.update(`/`.delete(` returns no other statement |
| Production not accessed or mutated | Two read-only `SELECT`s against production were issued in *this* pass, purely to prove the boundary: identity, and `information_schema.tables`. Production returns `global_instrument_overrides`, `global_instruments`, `instrument_map` — **`instrument_universe_manifests` does not exist in production**, which independently proves no registry write ever reached it |
| No deployment occurred | No publish/deploy was invoked; `REPLIT_DEPLOYMENT` unset; the production schema is missing the table a deployment would have propagated |

**Zero database writes were performed in this closure pass.**

---

## 7. CHANGED FILES

Modified (7):

- `artifacts/api-server/src/lib/registry/officialSources.ts` — BSE policy constant replaced; `BSE_SAME_RUN_TOLERANCE_MS` deleted; BSE branch of `computeFreshnessState` now IST-calendar-day
- `artifacts/api-server/src/lib/registry/universeManifest.ts` — schema version 2→3; required `bseAuthority` input; manifest field `bseReferenceAuthority`; Gate 4 (provenance + hash binding + authorization)
- `artifacts/api-server/src/lib/registry/coverageBridge.ts` — re-verifies stored BSE authority state and its hash binding at the authority boundary
- `artifacts/api-server/scripts/p06.persistGeneration.ts` — evaluates and passes BSE authority from honest inputs
- `artifacts/api-server/src/lib/registry/p06TestFixtures.ts` — `makeCurrentAuthoritativeBse()` built by the real policy function
- `artifacts/api-server/src/lib/registry/instrumentRegistry.p06.test.ts`, `manifestStore.p06.test.ts`, `universeManifest.p06.test.ts` — supply the new required input

New (3):

- `artifacts/api-server/src/lib/registry/bseReferencePolicy.ts`
- `artifacts/api-server/src/lib/registry/bseReferencePolicy.p06.test.ts`
- `artifacts/api-server/src/lib/registry/p06ClosureGuards.p06.test.ts`

Plus this report, and the directive text file auto-added under `attached_assets/`.

---

## 8. TARGETED TESTS AND TYPESCRIPT

- `src/lib/registry/` — 7 files / **148 tests PASS**
- `src/lib/marketData/` + `src/lib/health` — 21 files / **375 tests PASS** (run because the manifest shape changed)
- `tsc --noEmit -p tsconfig.json` — **clean**
- `scripts/p06.persistGeneration.ts` type-checked under the package's own compiler options via a temporary include (the package tsconfig covers `src` only) — **clean**; temp file removed
- `git diff --check` — **clean**

No full package suite, no build, no benchmark.

---

## 9. PROVIDER CALLS / DOWNLOADS IN THIS PASS

**None.** No official-source download, no Kite call, no HTTP request of any kind. The
policy module is pure and the tests use inline synthetic instants.

## 10. DATABASE READS / WRITES IN THIS PASS

- Reads (development): identity, `information_schema` tables/columns, manifest row
  metadata, relation size.
- Reads (production): identity, `information_schema` tables. Read-only, for the boundary proof.
- **Writes: none, in either environment.**

## 11. SUBSCRIPTION COUNT BEFORE / AFTER

Before: 50 configured NSE equities (`NIFTY50_SYMBOLS`) + the Kite index identity set
(~8 distinct index tokens) ≈ 58 subscribed tokens.
After: **identical.** No file in the subscription path was touched; a guard test pins the
50-symbol list and proves the registry contains no `subscribe(`, `setMode(`, `KiteTicker`
or `startTicker` reference.

## 12. FOUR EXACT SAFETY LOCKS

All verified `false as boolean` by source-text test (matrix item 16):

| Lock | File |
|---|---|
| `FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED` | `src/lib/candleEvaluationControl.ts` |
| `SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED` | `src/lib/candleEvaluationControl.ts` |
| `FNO_PAPER_V2_RUNTIME_AUTHORIZED` | `src/lib/v2PaperLocks.ts` |
| `SWING_PAPER_V2_RUNTIME_AUTHORIZED` | `src/lib/v2PaperLocks.ts` |

## 13. GIT STATUS AND AUTOMATIC COMMITS

Automatic commit from the previous pass: **`14736566`** on branch
`pack33c-p1-1-isolated` — "Implement phase 0.6 instrument registry foundation and update
market data aggregation logic", 23 files / 5,090 insertions: the 7 registry modules,
5 registry test files and fixtures, both `p06.*` scripts, `src/index.ts`,
`aggregateCoverageLive.ts`, `marketDataHealth.ts`, `lib/db/src/schema/runtimeTables.ts`,
the report, the directive text file and 3 memory files. All Phase 0.6 source/tests plus
inert files; **no unrelated runtime or configuration file**, so per section F work
continued and history was not rewritten.

`main` is at `e37a4a32`, untouched. The branch has unpushed commits; nothing was pushed,
merged or deployed in this pass. The working tree currently holds the section 7 changes,
uncommitted unless the platform auto-checkpoints them.

## 14. COST AND EXECUTION ACCOUNTING

Zero network egress, zero provider quota, zero database writes, no builds, no service
restarts, no full-suite runs. Compute: two targeted vitest invocations (1.19 s and 5.76 s),
three `tsc` invocations, and read-only SQL. One prior explore subagent produced the
consumer inventory; every path it reported was re-verified here by direct grep before
being written down. One code-review round was run and returned FAIL on two real defects,
both fixed before this report was finalised:

1. Manifest acceptance trusted the authority object's own boolean, so a hand-built
   verdict could mint an `ACCEPTED` manifest. Closed by runtime provenance (`WeakSet`)
   plus hash binding to the manifest's own BSE List provenance, re-applied durably in the
   coverage bridge.
2. UDiFF date validation checked shape only, so `2026-02-31` sorted like a real date and
   could reach authority. Closed by `isRealIstDate` calendar round-trip on both the UDiFF
   date and the calendar's completed-session date, evaluated before any comparison.

Seven new tests cover both; the review's remaining points (import safety, no
reintroduced threshold, NSE policy unchanged) were confirmed clean.

## 15. REMAINING BLOCKERS

Not blockers to this closure, but declared and carried forward:

1. **The two stored development generations no longer load.** They were written under
   manifest schema 1 and 2; the schema is now 3, and the loader correctly refuses a
   version mismatch. Coverage therefore reports `UNIVERSE_NOT_CONFIGURED` until a
   generation is rebuilt. This is the *designed* fail-closed behaviour, and rebuilding
   requires both a source download and a database write — both prohibited this pass.
   Consequence, not defect; needs authorization to clear.
2. **BSE UDiFF retrieval does not exist yet**, and the repo has **no BSE trading
   calendar** (`fnoTradingDays.ts` is Mon–Fri with no holiday list). Until both exist,
   `evaluateBseReferenceAuthority` will honestly return `UNAVAILABLE`/`INVALID` and no new
   BSE-bearing generation can be authorized. The persistence script now states this
   explicitly rather than fabricating a calendar. Next phase.
3. Boot-time restore in `src/index.ts` remains code-complete but never runtime-verified
   (no service has been started).
4. Four Phase 0.5C blockers stand unchanged: SSE fan-out backpressure, replay canonical
   identity fields, replay board snapshot stream, event-loop delay at full load.
5. Aggregate LIVE-status blocker (`deriveQuoteStatus` infers LIVE from a non-zero quote
   count) stands unchanged.

---

## VERDICT

AUTHORITATIVE_INSTRUMENT_REGISTRY_ACCEPTED_IN_DEVELOPMENT —
ZERO_UNEXPLAINED_REMAINDER —
BSE_REFERENCE_POLICY_OWNER_APPROVED —
DATABASE_ENVIRONMENT_PROVEN_DEVELOPMENT_ONLY —
CURRENT_SUBSCRIPTIONS_UNCHANGED —
INDEPENDENT_CHECKPOINT_AUTHORIZATION_REQUIRED
