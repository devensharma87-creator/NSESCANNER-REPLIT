# DATA FOUNDATION — PHASE 0.6

## Authoritative NSE/BSE Instrument Registry + Reconciled Universe Manifest

Directive: `attached_assets/Pasted-DATA-FOUNDATION-PHASE-0-6-AUTHORITATIVE-NSE-BSE-INSTRUM_1786527792325.txt`
Branch: `pack33c-p1-1-isolated` · Base HEAD at preflight: `083bca2c` · `main` untouched, never pushed
Date: 2026-08-12

---

## 1. Requirement → evidence

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Retrieve official NSE/BSE sources with provenance | **VERIFIED** | 6 sources in `.cache/p06-sources/`, each with `contentHash`, `retrievedAt`, `effectiveDate`, `rowCount`, `validationResult`, `freshnessState`. Retrieved **once**; every run since is offline. |
| 2 | Parse without corrupting source data | **VERIFIED** | `eq_etfseclist.csv` is Windows-1252, **not** UTF-8 — decoded `latin1`, else security names corrupt to replacement chars. Quote-aware `splitCsvLine`. |
| 3 | Per-source validation floors, fail-closed | **VERIFIED** | `REJECTED_EMPTY` / `REJECTED_MALFORMED` / `REJECTED_BELOW_FLOOR` / `UNAVAILABLE`; a rejected source cannot enter an accepted manifest. |
| 4 | Evidence-based security classification | **VERIFIED** | 25-value closed class enum. The official **`Segment` field is the authority, never the group letter** — proven by the four `Segment='PreferenceShares'` rows spread across groups P and Y. |
| 5 | Eligibility tiers | **VERIFIED** | 5-value tier enum + `violatesLiveTierInvariant`. Suspended outranks class; rights/unresolved can never be `LIVE_REQUIRED`. |
| 6 | Provider mapping, ambiguity never guessed | **VERIFIED** | NSE by series-qualified symbol, BSE by exchange token. Duplicate token ⇒ **all** claimants rejected. Ambiguous ⇒ rejected. No winner is ever picked. |
| 7 | Zero-remainder reconciliation | **VERIFIED** | Real-data run below: remainder **0** on both exchanges, 0 duplicate identities, 0 ambiguous, 0 UNRESOLVED among official records. |
| 8 | Versioned, immutable, checksummed manifest | **VERIFIED** | Frozen; checksum over key-sorted content excluding the checksum field; policy hash, eligible-live-set hash, and a **full record-set commitment**. Schema version now **2**. |
| 9 | Manifest binds the record set it describes | **VERIFIED** | `recordSetHash` covers every record in every tier. Enforced at commit, at load, and at the bridge. Tamper tests included. |
| 10 | PostgreSQL durability | **VERIFIED (executed)** | Real dev commit `P06-c868d08c6ed46d76`, `snapshotId=4`, 9,702 records; **cold-start reload** self-verifies checksum and record-set commitment. Advisory lock `6413902`, `ON CONFLICT DO NOTHING`, retention 3 in-transaction, `MIN_RECORDS_FOR_COMMIT=1000`, L0/L1 only after commit. |
| 11 | Instrument history carried across generations | **VERIFIED (executed)** | Second run carried 9,702 prior entries; `firstSeenAt` set on **9,493 / 9,493** records. Keyed on `authoritativeSecurityId`. |
| 12 | Coverage integration (0.5B denominator) | **VERIFIED** | `toAuthoritativeCoverageManifest` injected into `buildLiveAggregateCoverage`; independently re-applies every acceptance gate. Live run yields `AUTHORITATIVE_RECONCILED_UNIVERSE`, 7,880 required instruments. |
| 13 | Boot-time restore | **CODE COMPLETE, NOT RUNTIME-VERIFIED** | `src/index.ts` Step 6, detached and non-fatal. Server **not started** (cost constraint), so this call site is unproven at runtime — the loader itself was proven by the durability script. |
| 14 | BSE reference freshness policy | **OWNER DECISION OUTSTANDING** | `BSE_REFERENCE_FRESHNESS_POLICY = "OWNER_AUTHORIZATION_REQUIRED"`. A BSE source is `CURRENT_AUTHORITATIVE` only for the run that retrieved it; later reuse degrades to `LAST_KNOWN`. |
| 15 | Consumer classification | **NOT IMPLEMENTED** | No consumer reads the registry as its universe authority. |
| 16 | ≥66 tests | **EXCEEDED** | **88** registry tests. 500 pass across registry + marketData + health. `tsc --noEmit` clean. |

---

## 2. Reconciliation over real data

```
NSE   official 3303   LIVE_REQUIRED 2961 (mapped 2960 + unmapped 1)
                      SNAPSHOT_ONLY  342   UNAVAILABLE 0   REMAINDER 0   ok=true
BSE   official 6190   LIVE_REQUIRED 4711 (mapped 4708 + unmapped 3)
                      SNAPSHOT_ONLY  257   UNAVAILABLE 1222  REMAINDER 0   ok=true
indices 209 · BSE active+suspended 6190 reconciles=true (suspended 1219)
duplicate identities 0 · duplicate tokens retained 0 · ambiguous 0

manifest P06-c868d08c6ed46d76  ACCEPTED  0 blockers  frozen
tiers {LIVE_REQUIRED 7880, SNAPSHOT_ONLY 599, UNAVAILABLE 1222, EXCLUDED_NON_STOCK 0, UNRESOLVED 1}
```

Unmapped live: 3 BSE `IP` scrips and NSE `SWARAJ`.

---

## 3. Defects found and fixed

**Found by running against real data**

1. **All 342 official NSE ETFs were missing.** The ETF publication shares **zero** symbols with `EQUITY_L.csv`, so treating it as a reclassification overlay excluded every one. Now built as official records in their own right, with a dedupe guard.
2. **Four records were UNRESOLVED** — officially `Segment='PreferenceShares'`; now classified on that official evidence.

**Found by writing the tests**

3. **`firstSeenAt` was keyed on `canonicalInstrumentId`** — nullable and derived from the trading symbol, so a symbol or series change would silently reset an instrument's history. Re-keyed onto the stable `authoritativeSecurityId`.
4. **Duplicate provider tokens were invisible.** The counter only counted *retained* tokens, so a successful rejection drove it to 0 and the operator could never learn instruments had been dropped. Added `duplicateTokenRejectedCount`.

**Found by code review**

5. **The manifest did not bind its record set — the most serious defect of the phase.** `eligibleLiveSetHash` covers only *mapped* `LIVE_REQUIRED` rows. An **unmapped** `LIVE_REQUIRED` record could therefore be deleted or demoted and the checksum, live-set hash and tier arithmetic would all still verify — silently shrinking the coverage denominator while the bridge asserted `AUTHORITATIVE_RECONCILED_UNIVERSE`. This is precisely the false-completeness failure the phase exists to prevent. Fixed with `recordSetHash` over every record, enforced at commit, load and bridge, plus a record-count check.
6. **The bridge did not enforce schema or policy versions.** As the authority boundary it cannot assume the loader ran; a self-consistent manifest from another policy would have been labelled authoritative. Now re-applies all gates itself.
7. **`priorFirstSeen` had no production call site**, so every real build stamped `firstSeenAt: null`. Now wired into the generation path.

**Found by executing the durable path twice**

8. **Content-derived generation ids deadlocked across a version bump.** The id hashed source content only, so after the schema bump the new generation collided with the stale row, `ON CONFLICT DO NOTHING` skipped the write, and the loader rejected the stale row for version mismatch — leaving the universe **permanently** `UNIVERSE_NOT_CONFIGURED` while the write still reported `ok: true`. Schema and policy versions are now part of the generation identity.

Defects 1–2 required real data, 3–4 required writing tests, 5–7 required review, and 8 only appeared on the second execution. None were reachable from fixtures alone.

---

## 4. Honest limitations — read before trusting these numbers

- **`EXCLUDED_NON_STOCK` is 0 on both exchanges.** Not because nothing was excluded, but because **only equity and ETF masters are ingested**. Derivatives, currency and commodity instruments never enter the equations. The zero describes the input scope, not the market.
- **Tier is a POLICY tier, not a mapping outcome.** An unmapped `LIVE_REQUIRED` security stays `LIVE_REQUIRED` and is counted as unmapped. The denominator therefore *includes* instruments the platform currently cannot price — deliberately, because demoting them would erase the gap instead of reporting it.
- **One index cannot form a canonical identity:** BSE `BSE SENSEX SIXTY 65:35` (token 403209). Its symbol contains `:`, the delimiter of `EXCHANGE:SEGMENT:SYMBOL`. Minting refuses it rather than producing an ambiguous id; the record is retained as `UNRESOLVED`, not dropped.
- **No price or subscription claim is made.** `subscriptionRequestedCount` is 0 by construction; `validationProviderStatus` is `NOT_CHECKED` for every record. The registry asserts *what exists*, never *what is live*.
- **Coverage cannot be inflated by this change.** The configured feed remains `LEGACY_PARTIAL_CONFIGURATION`; a count mismatch raises `AUTHORITATIVE_COVERAGE_INCOMPLETE`.
- **The dev database now holds a stale schema-1 generation** alongside the current one. It is correctly rejected on load; retention (3) will age it out.

---

## 5. Safety locks — re-verified `false`

| Lock | File | Value |
|---|---|---|
| `FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED` | `candleEvaluationControl.ts:44` | `false as boolean` |
| `SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED` | `candleEvaluationControl.ts:117` | `false as boolean` |
| `FNO_PAPER_V2_RUNTIME_AUTHORIZED` | `v2PaperLocks.ts:39` | `false as boolean` |
| `SWING_PAPER_V2_RUNTIME_AUTHORIZED` | `v2PaperLocks.ts:40` | `false as boolean` |

Prohibitions honored: no subscription expansion, no deploy/push/merge, no indicators/candles/SMC, no Upstox or IndianAPI integration, no replay JSON shape change, no production DB write.

---

## 6. COST_AND_EXECUTION_ACCOUNTING

| Item | Count | Note |
|---|---|---|
| Network fetches | **0** | All six sources served from the one-time cache. |
| Browser sessions | **0** | Prohibited; none used. |
| Service restarts | **0** | Prohibited; none performed. All workflows remain stopped. |
| Broad test suites | **0** | Targeted runs only: 88 registry, then 500 across registry + marketData + health. |
| `tsc --noEmit` runs | 7 | Batched after groups of edits, never per-edit. |
| Development DB writes | **2 generations** | Schema-1 proof, then the current schema-2 generation. |
| Production DB writes | **0** | Prohibited; none performed. |
| Benchmarks | **0** | None required this phase. |
| Subagents | 3 | 2 test authors (background, joined once), 1 code review. |
| Git commits | **0** | Working tree uncommitted; HEAD unchanged at `083bca2c`. No auto-checkpoint observed. |

### Uncommitted changes

Modified: `aggregateCoverageLive.ts`, `marketDataHealth.ts`, `lib/db/src/schema/runtimeTables.ts`, `src/index.ts`
Added: `src/lib/registry/` (7 modules, 5 test files, fixtures), `scripts/p06.registryEvidence.ts`, `scripts/p06.persistGeneration.ts`, this report

`instrumentUniverseManifests` is declared in `runtimeTables.ts` — without it, `drizzle-kit push` would schedule a **DROP** of the live table.

---

## 7. Verdict

Requirements 1–12 and the test floor are verified against real data, including an executed PostgreSQL commit, a cold-start restore, and history carry-forward across two generations. Two requirements remain genuinely unmet, one of which is a decision only the owner can make.

**DATA_FOUNDATION_PHASE_0_6_BLOCKED — two unmet requirements:**

1. **Consumer classification is not implemented.** No consumer reads the registry as its universe authority, so the manifest is authoritative in storage but not yet in use.
2. **`BSE_REFERENCE_FRESHNESS_POLICY` is `OWNER_AUTHORIZATION_REQUIRED`.** BSE publishes no dated security master; whether a reused BSE snapshot may back a `LIVE_REQUIRED` tier — and for how long — is a data-trust decision reserved for the owner.

Additionally, the boot-time restore at `src/index.ts` Step 6 is code-complete but not runtime-verified, because starting the server was outside the cost constraint.
