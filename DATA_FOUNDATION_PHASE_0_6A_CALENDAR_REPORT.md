# DATA FOUNDATION — PHASE 0.6A

## Authoritative exchange calendar and final registry acceptance

Development environment only. Nothing deployed, pushed, merged or published.
Date of run: 2026-08-12 (IST).

---

## 1. What was blocking, and what unblocked it

Phase 0.6 closed with `PHASE_0_6_BLOCKED — AUTHORITATIVE_TRADING_CALENDAR_REQUIRED`.
The BSE reference policy could not authorize a new generation because it had no
way to answer one question: *which session was the latest completed one?* The
only session logic in the repo was `fnoTradingDays.ts`, which is Monday–Friday
and says so — it cannot see an exchange holiday, and it cannot see a Sunday on
which the exchange actually trades.

Phase 0.6A supplies that answer from official exchange documents, and the
generation was accepted, persisted and cold-loaded as a result.

---

## 2. Official sources used (each retrieved once, then cached)

| Exchange | Document | Retrieval | Events | SHA-256 (first 16) |
|---|---|---|---|---|
| NSE | Trading-holiday master, segment CM, 2026 | `nseindia.com/api/holiday-master?type=trading` (cookie warm-up required) | 20 | `798c545acc5351eb` |
| BSE | Trading Holidays, equity segment, 2026 | `bseindia.com/static/markets/marketinfo/listholi.aspx` | 17 (16 holidays + 1 Muhurat) | `bd949641581893d7` |
| BSE | UDiFF / Common Bhavcopy, CM, 2026-08-12 | official BhavCopy download | 4,948 rows, session `F1` | `367d0109e84cade2` |

No third-party holiday site, broker calendar, search snippet or inferred
holiday was used anywhere.

**Honest note on the BSE retrieval mechanism.** BSE's holiday JSON API returned
a 302 to an error page under every path attempted — it is bot-blocked. The
official Trading Holidays page is served as a compiled application view, so the
published equity-segment table arrives inside the page bundle rather than as
server-rendered HTML. The parser reads the table out of BSE's own artefact from
BSE's own origin; it is the exchange's document, obtained the way the exchange
serves it, and the parser is anchored on the published caption
`Display table for Trading Holidays for 2026 - Equity Segment` so it can never
silently read the currency-derivatives table that follows it.

**Cross-exchange consistency.** NSE lists four holidays that fall on weekends
(15-Feb, 21-Mar, 15-Aug, 08-Nov) which BSE omits from its table. The effective
set of closed days is therefore identical between the two exchanges; the
difference is presentational, and the calendars are versioned separately.

---

## 3. The calendar contract

> Superseded in part by §13: the shared session-time constant described below was
> removed, and integrity was split from current authority. §13 is authoritative.

`exchangeCalendar.ts` — pure: no network, no filesystem, no clock, no database,
no provider. Parsers live in `exchangeCalendarSources.ts` and are equally pure;
bodies and evaluation instants are supplied by the caller.

`sessionType` ∈ `REGULAR | SPECIAL | MUHURAT | HALF_DAY | CLOSED`.

Five required functions, all implemented:

| Function | Behaviour |
|---|---|
| `isTradingDate` | `true` / `false` / **`null` = unknown**, which callers must fail closed on |
| `getTradingSession` | full session record, or an explicit unknown with a reason |
| `getLatestCompletedTradingSession` | scans backwards from the IST day; returns a session only when its official close has passed |
| `getPreviousTradingSession` | latest open session strictly before a date |
| `validateBhavcopySession` | accepts a bhavcopy only when it is exactly the latest completed session |

The calendar **enumerates every day of every covered year for every covered
exchange** (730 records for NSE+BSE 2026) rather than storing only overrides.
No consumer ever has to reconstruct what the default would have been, and the
checksum covers every individual session.

### The twelve rules

1. **IST throughout.** Dates are IST calendar dates; session closes are IST
   wall-clock times converted to epoch ms through one helper.
2. **Completion only after the official close.** One millisecond before
   15:30 IST the day is not completed (proved in T23).
3. **A session in progress or in pre-open is simply not completed** — the scan
   continues to the previous one.
4. **Unknown fails closed.** Uncovered year, unreal date, invalid calendar and
   missing annual source all return unknown, never a guess.
5. **Contradictory equal-priority sources are rejected**, not resolved.
6. **A year with no accepted official annual calendar is invalid**, even if
   circulars for that year exist.
7. **A declared session with no officially notified timings fails closed and is
   never skipped.** Skipping it would falsely nominate an older session as
   "latest" — the single most dangerous silent error available here.
8. **The UDiFF must equal the calculated latest completed session.** Older is
   `NOT_LATEST_COMPLETED`, newer is impossible, future-dated is `INVALID_DATE`.
9. **No hourly freshness threshold exists anywhere in the module.** Completion
   is decided by the official close instant, never by age. Verified by source
   inspection in T31.
10. **Weekday assumptions are absent.** A weekday holiday is closed; a Sunday
    with a declared session is open.
11. **Weekend and holiday are distinguished** in `dayKind`, so downstream
    reasons stay honest.
12. **Calendar authority never makes a quote LIVE.** It establishes session
    identity only; it never implies a subscription and grants no reference
    authority on its own.

---

## 4. Source-update policy (Section D)

A later, specifically applicable **official circular** outranks the annual
calendar (`OFFICIAL_CIRCULAR` > `ANNUAL_CALENDAR`); among equals the later
official issue date wins. Both documents are preserved in provenance, and the
displaced declaration is recorded in `overrideReason` on the affected day, so
the override is auditable rather than invisible. Two contradictory sources of
equal priority produce a blocker and invalidate the calendar — the code refuses
to pick a winner it has no authority to pick. (T20, T21.)

---

## 5. Durability — and why there is no new table

**No new database table was created.** The calendar is committed inside the
registry manifest as `tradingCalendar`, and the proof that this is sufficient
rather than merely convenient is as follows.

- **The manifest already is the durable record.** It is checksummed, immutable,
  cold-loaded from PostgreSQL and last-good-preserving. A second table would
  duplicate all four properties and add a fifth failure mode: calendar and
  manifest drifting apart.
- **The commitment is inside the checksum.** `manifestChecksum` is computed over
  the whole manifest, so the calendar cannot be edited after acceptance without
  invalidating the generation.
- **The binding is verifiable without the rows.** `calendarGenerationId` is
  *derived* from `calendarChecksum` (`CAL-<checksum[0:16]>`), never chosen. A
  reader holding only the commitment can re-check that relationship. Tampering
  with either half breaks it (T30).
- **The gate is re-applied on load, not just on write.** `coverageBridge.ts`
  re-verifies the commitment structurally *and* re-checks that the stored BSE
  authority's `effectiveTradingDate` still equals the committed latest completed
  BSE session. A manifest restored from storage with a broken calendar yields
  `AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED`.
- **An invalid calendar cannot reach storage.** Gate 5 in `buildUniverseManifest`
  rejects it, and a rejected manifest never replaces the previous accepted one.
- **The enumerated sessions ARE embedded** — 730 records for NSE+BSE 2026. This
  reverses an earlier judgement of mine, and the reversal is the single most
  important correction in this phase; §10 explains why.

`MANIFEST_SCHEMA_VERSION` is **4**. It was 3 for the first run; the remediation
below changed the manifest shape after a schema-3 row had already been
persisted, so the version had to move rather than the shape being widened in
place. The schema-3 row is left intact in the development database and is
rejected on load by version mismatch — which is the designed behaviour, observed
in the second run's log.

---

## 6. Tests (Section F) — 33 required, 36 total, all passing

`artifacts/api-server/src/lib/registry/exchangeCalendar.p06a.test.ts`

All fixtures are deterministic and in the official format of the source they
stand for — the NSE holiday-master JSON payload, the BSE equity-segment table as
the exchange's page serves it, and the UDiFF CSV header set.

| # | Group | Covers |
|---|---|---|
| T01–T06 | NSE holiday master | acceptance; weekday-contradiction rejection; empty/non-JSON; missing CM segment; below-floor truncation; duplicate and out-of-year dates |
| T07–T11 | BSE holidays page | equity table only (not the currency table below it); Sunday Muhurat with **timings not notified**; Muhurat **with** notified timings; missing table; weekday mismatch and below-floor |
| T12–T16 | BSE UDiFF | final file accepted and completed; intraday variant never completed; mixed trading dates; truncation and wrong segment; missing official header columns |
| T17–T21 | Construction | full-year enumeration for both exchanges; weekday holiday closed, Saturday closed, **Sunday Muhurat open**; missing annual calendar fails closed; contradictory equal-priority rejection; circular override with both sources preserved |
| T22–T27 | Queries | session in progress not completed; completion at the exact close instant; **no-notified-timings fails closed instead of skipping**; uncovered year and unreal date; walk-back over weekends and holidays; verdict adaptation, unknown when invalid |
| T28–T29 | Bhavcopy | exact-match acceptance and the three rejection codes; future-dated, non-session, unreal; unknown latest session |
| T30 | Commitment | id derived from checksum; structural re-verification; tamper detection; missing commitment; one-sided calendar; determinism |
| T31–T33 | Guards | no hour-based freshness threshold; no subscription/provider/tick/quote path, no I/O, no ambient clock, NIFTY-50 list still 50, NSE 48-hour policy still 48; four safety locks still `false` |

Wider regression: **202 tests passing** across the nine registry and
candle-control test files.

---

## 7. The controlled rebuild (Section G) — evidence

Command: `npx tsx scripts/p06.persistGeneration.ts` — cached bytes only, no
network, development database only. **Executed exactly once.**

| # | Evidence | Result |
|---|---|---|
| 1 | Database identity | `heliumdb` / `postgres` (development) |
| 2 | Rows before | ids 1 (schema 1) and 4 (schema 2), both ACCEPTED |
| 2b | Rows after run 1 | id 7 (schema 3) ACCEPTED — superseded by the remediation, see §10 |
| 3 | Calendar built | `CAL-44b4524deedd0ed0`, `valid=true`, blockers none, 730 sessions |
| 4 | Calendar sources | NSE CM 20 events ACCEPTED; BSE equity 17 events ACCEPTED |
| 5 | Latest completed NSE | 2026-08-12 |
| 6 | Latest completed BSE | 2026-08-12 |
| 7 | UDiFF selected by that date | `bse_udiff_20260812.csv`, 4,948 rows, session `F1` |
| 8 | UDiFF session match | `VALID_LATEST_COMPLETED` |
| 9 | BSE authority | `CURRENT_AUTHORITATIVE`, `mayAuthorizeNewGeneration=true`, effective date 2026-08-12 |
| 10 | Manifest | `P06-fc10a259b34501cf`, **ACCEPTED**, zero blockers, frozen, schema 4 |
| 11 | Counts | 9,493 official + 209 indices = 9,702 records; tiers LIVE_REQUIRED 7,880 / SNAPSHOT_ONLY 599 / UNAVAILABLE 1,222 / EXCLUDED_NON_STOCK 0 / UNRESOLVED 1 |
| 12 | Durable write | `durablyCommitted=true`, `POSTGRESQL`, snapshot id 8 |
| 13 | Cold-start reload | in-memory layer cleared; restored 9,702 records; checksum self-verifies; record set intact; same universe as built |
| 14 | Coverage bridge | `AUTHORITATIVE_RECONCILED_UNIVERSE`, 7,880 required ids, reconciliation valid, **subscriptionRequested 0** |
| 15 | Restored calendar commitment | same `CAL-44b4524deedd0ed0`, 730 sessions and 2 sources stored, checksum recomputed from contents, latest completed session re-derived, zero blockers, bound to authority `true` |
| 16 | Rows after | id 8 added, schema 4, ACCEPTED, 9,702 records; earlier rows untouched (id 1 aged out by the retention window) |

The stale L1 disk cache was correctly rejected on load with a schema/policy
mismatch warning before PostgreSQL served the current row — schema 2 in the
first run, schema 3 in the second, each time the version gate doing its job.

**Zero unexplained remainder.** 9,493 official records + 209 index records =
9,702 stored; the five tiers sum to 9,702; the single `UNRESOLVED` record is the
known, carried-forward Phase 0.6 item, not a new gap.

---

## 8. Safety locks and blast radius (Section I)

| Lock | File | Value |
|---|---|---|
| `FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED` | `lib/candleEvaluationControl.ts` | `false as boolean` |
| `SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED` | `lib/candleEvaluationControl.ts` | `false as boolean` |
| `FNO_PAPER_V2_RUNTIME_AUTHORIZED` | `lib/v2PaperLocks.ts` | `false as boolean` |
| `SWING_PAPER_V2_RUNTIME_AUTHORIZED` | `lib/v2PaperLocks.ts` | `false as boolean` |

- **Production not mutated.** The production database (`neondb`) has no
  `instrument_universe_manifests` table at all — confirmed by direct query.
- **Subscriptions unchanged.** `NIFTY50_SYMBOLS` is still 50 symbols; the
  coverage bridge reports `subscriptionRequestedCount = 0`. No WebSocket,
  ticker or subscription code was touched.
- **No deploy, no push, no merge.** Branch `pack33c-p1-1-isolated` at
  `14736566`; `main` untouched at `e37a4a32`.
- **`git diff --check`** clean.

---

## 9. Cost control (Section H)

Targeted test runs only (registry directory plus the candle-control lock file),
`tsc --noEmit` on the package and once on the script with a temporary in-package
config, and `git diff --check`.

**The rebuild ran twice, not once.** The first was the authorized proof run and
it succeeded. The code review then found that the calendar commitment was not
actually verifiable (§10), and the fix changed the durable shape — leaving the
persisted row unverifiable under the corrected contract would have been the
worse outcome, so a second, corrective run was made. Both runs used only cached
bytes and the development database. I am reporting the overrun rather than
presenting the second run as the first.

---

## 10. Code-review remediation — the commitment was not a commitment

The review returned **FAIL** on the design I had just described as sufficient,
and it was right on both counts.

**(a) An unverifiable checksum is a claim, not a commitment.** The original
`TradingCalendarCommitment` carried the checksum, the derived id and the
resulting latest completed session — but not the sessions. So
`verifyCalendarCommitment` could only confirm that the id derived from an
*asserted* checksum. Nothing tied that checksum to any real calendar. A caller
could pair a fabricated commitment naming any convenient session date with a
genuine authority verdict and mint an accepted manifest, and the coverage bridge
would repeat the same hollow check on restore. My "the checksum already covers
it" argument was circular: the manifest checksum covers whatever the commitment
says, and the commitment said only what it asserted about itself.

The fix embeds the enumerated sessions. `verifyCalendarCommitment` now
**recomputes** the checksum from the committed contents through the same
function the builder uses, and **re-derives** the latest completed session from
those sessions at the committed instant. `latestCompletedSession` is not part of
the checksum, so a checksum-correct calendar that *claims* a session its own
records do not support is caught only by that re-derivation — and now is.

**(b) The row floor was not a truncation defence.** The BSE page parser accepted
once it had eight numbered rows. A body carrying the caption, the header and a
valid eight-row prefix followed by bot-block or truncated content parsed as
`ACCEPTED`, and every later holiday silently became an ordinary trading day —
precisely the wrong-but-plausible calendar this phase exists to prevent. Two
requirements now close it: the currency-derivatives caption that terminates the
equity table is **mandatory**, so a truncated document is rejected rather than
half-read; and after the row loop stops, no row-number-shaped cell may remain
inside the table, so a single inserted or missing cell is reported as lost
alignment instead of quietly dropping the rows beyond it.

**Three adversarial tests were added (T34–T36)** for exactly these: a valid
eight-row prefix with no terminator, an inserted cell mid-table, and a
fabricated-but-structurally-valid commitment rejected at all three boundaries —
`verifyCalendarCommitment`, the manifest gate, and the coverage bridge on
restore. Total now 36 tests; 184 passing across the registry suite.

---

## 11. Files

**New**
- `artifacts/api-server/src/lib/registry/exchangeCalendar.ts`
- `artifacts/api-server/src/lib/registry/exchangeCalendarSources.ts`
- `artifacts/api-server/src/lib/registry/exchangeCalendar.p06a.test.ts`

**Modified**
- `universeManifest.ts` — required `tradingCalendar` on the manifest and build input; Gate 5
- `coverageBridge.ts` — calendar re-verified at the authority boundary
- `p06TestFixtures.ts` — calendar fixture helpers
- `scripts/p06.persistGeneration.ts` — real calendar, real UDiFF, real verdict
- four `*.p06.test.ts` files — new required field at 23 call sites

---

## 12. What is still open

- `LEGACY_NSE_DEFAULTING_CONSUMERS_REQUIRE_MIGRATION` — eight sites still
  default to NSE without exchange qualification.
- Legacy `LIVE_TICKS` serialization. **Correction:** Phase 0.5B already prevents
  legacy `LIVE_TICKS` from granting complete or trade-grade status, so this is
  not an unfixed aggregate-authority implementation. What remains is deprecated
  serialization still being emitted — a cleanup, not an authority hole.
- Four Phase 0.5C items.
- Calendar coverage is 2026 only. A run in January 2027 will fail closed with
  `no official NSE calendar for year 2027` until the 2027 documents are
  retrieved — which is the intended behaviour, not a defect.
- Boot-time restore has still never been verified in a live server process; the
  cold-load proof here runs inside the script.

---

## 13. Session-time and current-authority correction (Phase 0.6A follow-up)

The read-only authority review of the persisted schema-4 generation returned two
P1 blockers. Both are closed here, and nothing else was touched.

### 13.1 `REGULAR_SESSION_CLOSE_TIME_NOT_AUTHORITATIVE_AND_NOT_EXCHANGE_INDEPENDENT`

The calendar decided session completion against `15:30` from a constant shared by
both exchanges. Session identity — the thing the entire BSE reference authority
hangs on — was therefore anchored on a number this codebase asserted, and NSE and
BSE could never diverge even if an exchange changed its hours.

Each exchange now carries its own official timing document, parsed with its own
provenance and its own reproducible evidence rows:

| Exchange | Document | Bytes | SHA-256 (first 16) | Hours read | Evidence rows |
|---|---|---|---|---|---|
| NSE | `nseindia.com/market-data/market-timings` | 315,466 | `9e6fd60ca4417cae` | 09:15–15:30 | 6 |
| BSE | Continuous Trading Session row, BSE application bundle | 15,501,143 | `bd949641581893d7` | 09:15–15:30 | 3 |

Each document must also prove it arrived COMPLETE before a time is read from
    it — see §13.4 item 2. The hours coincide. That is a finding, not an assumption: neither exchange's
times are inherited from the other, and removing one document does not leave the
other exchange with a usable close time — it fails closed, per exchange.

NSE's document also yields pre-open (09:00–09:08) and the closing session
(15:40–16:00). BSE's does not publish those in a uniquely anchorable form, so
they are committed as `null`. The asymmetry is honest; a guessed pre-open would
not be.

**Precedence, in order:** an exceptional circular for that date; a
special/Muhurat/half-day circular; the exchange's regular timing document;
otherwise fail closed. `HALF_DAY` is only ever set by an official override — it
is never inferred from short hours. Two equal-priority sources that disagree
produce `REJECTED_AMBIGUOUS`, never a resolution in our favour.

### 13.2 `ACCEPTED_CALENDAR_AUTHORITY_DOES_NOT_EXPIRE`

Integrity and current authority were the same check, so a commitment that was
internally perfect stayed "verified" forever, including on a date its sources
never covered.

They are now two things:

- `verifyCalendarCommitmentIntegrity()` — clock-free. Recomputes the checksum
  over the committed material, re-derives the committed conclusion, and requires
  an accepted per-exchange timing source with evidence. Immutable: it answers the
  same way in 2027 as it did on the day of the write.
- `evaluateCalendarAuthorityNow(commitment, nowMs)` — clock-dependent.
  `CURRENT_AUTHORITATIVE` / `LAST_KNOWN` / `STALE`, plus the instant the answer
  stops being valid.

Wired at five boundaries: the coverage bridge, manifest build, manifest
acceptance, generation load, and the active-generation accessor. Stored
checksums are never rewritten — expiry changes what the system is willing to
*claim*, not what it stored.

Each boundary memoizes a single entry keyed on the generation id and the
validity instant, so nothing scans 9,702 records per tick.

**The operational consequence, stated loudly:** BSE current authority expires at
**midnight IST**, because the approved policy requires a current-day
List-of-Scrips retrieval — not because a newer session has completed. Expiry
therefore arrives *before* the next session completes, and can arrive on a day
that holds no session at all. At that instant an accepted generation drops to
`LAST_KNOWN` and the coverage boundary stops issuing a denominator. **The registry
must be refreshed every trading session.** NSE drift is recorded but not
authority-losing.

### 13.3 Retention — the real contract

Documented at the DELETE in `manifestStore.ts`.

**Correction (supersedes the earlier statement in this section).** An earlier
version of this document said retention "also runs on the `ON CONFLICT DO
NOTHING` path". That was true of the code and it was wrong. Retention exists to
bound the table as new generations arrive; a run that inserts nothing has bought
no room and must prune nothing. Re-running an identical generation, or replaying
an old one, could otherwise delete history it did not extend.

The contract now enforced and tested: retention executes **only** when the INSERT
in this transaction created exactly one row. On the `ON CONFLICT DO NOTHING`
path the function returns before the DELETE and reports an honest no-op
(`durablyCommitted: false`, `skippedReason: "DUPLICATE_GENERATION_ID"`, no
snapshot id, no commit time). Validation failure opens no transaction at all. A
failing DELETE rolls the new row back with it. Retention touches the registry
manifest table and nothing else, and keeps the newest three rows by
`generated_at` tie-broken on `id` — deterministic when two generations share a
timestamp — across *every* schema and policy version. Accepting new generations
is what evicted the schema-1 rows; that evidence is pruned, gone, and is not
reconstructed. Older rows are history, not backups.

### 13.4 Two parser defects found by the controlled run

Both were caught **before** anything was persisted — the run fail-closed exactly
as designed, and no durable row was written until they were fixed.

1. **Whole-body interstitial scan.** The block-page check scanned the entire body
   for `captcha`. BSE's own application bundle contains that word 357 times, the
   first a megabyte in, so a valid source was rejected as a bot challenge. The
   check now reads only the leading 4 KB, and trusts the generic marker only when
   the body is small enough to actually be a challenge page.
2. **Finding the row is not proof of the document.** Both parsers accepted as
     soon as their anchor appeared, so a truncated response — or a padded body
     carrying a copied row — would have been read as authoritative. Each source now
     has to prove it arrived complete before any time is taken out of it: NSE must
     publish EVERY labelled row of the cash-market table and must end with its
     closing `</html>`; BSE must be bundle-scale, must carry the published equity
     trading-holidays caption that identifies it as BSE's own artefact (the same
     artefact the accepted holidays parser reads), and must end on a terminated
     statement. Found by code review, before persistence.
    3. **Unanchored prose matched as a published timing.** The BSE anchor matched
   `…with the continuous trading sessions from 9.00 a.m. to 3.30 p.m` — G-Sec
   retail prose, present in two versions that disagree with each other — which
   correctly produced `REJECTED_AMBIGUOUS`, but for the wrong reason: the real
   labelled row was being missed entirely, because the dash arrives as a literal
   `\u2013` escape whose digits broke the separator. The label must now start a
   cell or string literal and be singular. Three agreeing labelled rows are now
   read; the prose is not.

### 13.5 Controlled dev proof

```
OFFICIAL TIMINGS   NSE ACCEPTED 09:15–15:30 (6 evidence)  BSE ACCEPTED 09:15–15:30 (3 evidence)
CALENDAR           CAL-ab94ecfee219a2ee  valid=true  blockers=(none)
LATEST COMPLETED   NSE 2026-08-12   BSE 2026-08-12
UDiFF              2026-08-12  4,948 rows  session F1  VALID_LATEST_COMPLETED
BSE AUTHORITY      CURRENT_AUTHORITATIVE  mayAuthorizeNewGeneration=true
MANIFEST           P06-b1632484542c83eb  ACCEPTED  schema 5  blockers=(none)
DURABLE WRITE      ok=true  POSTGRESQL  snapshot 9  2026-08-12 12:58:44Z
COLD-START RELOAD  9,702 records  checksum self-verifies  recordSet intact
COVERAGE           AUTHORITATIVE_RECONCILED_UNIVERSE  required 7,880  subscriptionRequested 0
COMMITMENT         integrity blockers []  timings committed 2  bound to authority true
AUTHORITY NOW      CURRENT_AUTHORITATIVE  validUntil 2026-08-12T18:30:00Z
SIMULATED 2027     LAST_KNOWN → coverageAuthority UNIVERSE_NOT_CONFIGURED, required 0
                   stored commitment unchanged (checksum identical, integrity still [])
```

Tier counts are unchanged from §7: 9,493 official + 209 indices, LIVE_REQUIRED
7,880, SNAPSHOT_ONLY 599, UNAVAILABLE 1,222, UNRESOLVED 1. Zero subscribe or
unsubscribe operations were issued.

### 13.6 Tests

32 new tests (T37–T68) in `exchangeCalendarTiming.p06a.test.ts`, across six
groups, now including adversarial completeness cases (truncated page, missing
    published row, truncated bundle, bundle-scale body that is not BSE's artefact,
    row-only fragment — all rejected): sourced per-exchange hours; fail-closed absence; precedence and
completion boundaries; integrity versus current authority; the five boundary
wirings; and an out-of-scope guard that re-asserts zero subscriptions, the four
safety locks still `false`, and no provider import in the source path.

Post-hardening the cached documents were re-parsed and still yield identical
    hashes, times and evidence, so the persisted generation remains reproducible
    under the current code and was not rewritten.

    Registry suite: 216 passing (9 files). Targeted consumer suites re-run with it:
341 passing (14 files). `tsc --noEmit` clean for api-server, and for
`scripts/` under a temporary in-package config.

---

## Verdict

```
AUTHORITATIVE_EXCHANGE_SESSION_TIMES_VERIFIED —
CURRENT_AUTHORITY_EXPIRES_FAIL_CLOSED —
REGISTRY_ACCEPTED_AND_COLD_LOADED_IN_DEVELOPMENT —
ZERO_UNEXPLAINED_REMAINDER —
PRODUCTION_NOT_MUTATED —
CURRENT_SUBSCRIPTIONS_UNCHANGED —
INDEPENDENT_CHECKPOINT_AUTHORIZATION_REQUIRED
```
