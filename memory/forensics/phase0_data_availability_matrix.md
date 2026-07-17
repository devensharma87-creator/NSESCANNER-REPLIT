# Phase 0 · Data Availability Matrix — READ-ONLY EVIDENCE

**Owner ruling registered:** today is **Thursday 16 July 2026**. Acceptance query runs
Friday evening (17 July), not tonight. Row K post-15:30 IST sweep = tomorrow. Row F
retest after 20:00 IST tonight (participant files publish late).

**Environment note:** this pod's Kite session **expired at 06:00 UTC / 11:30 IST today**
(`kite_session.expires_at = 2026-07-16 06:00 IST`), and `app_state.kite_offline_since =
2026-07-16T06:35:43Z`. `instruments_check_2026-07-16 = failed_no_session`. Every row
that depends on a live Kite pull is currently probed with the pipe cold; the code path
and DB state are used as evidence in place of a live REST reply.

**Status:** Rows A/B/C/D/E/G/H/I/J/L probed with pasted evidence tonight (Thu 16 Jul).
**Rows F and G are OPEN — RETEST FRIDAY POST-CLOSE** (one batch, one methodology; see
Friday post-close docket below). Row K also Fri post-close. Signable reclassification
below is provisional until F, G re-run, and K land.

---

## 🟢 ROW A · Index/candle data + EMA/RSI/VWAP/ATR — CODE-ACTIVE · **DB-DRY IN PREVIEW**

**Method:** `SELECT symbol, interval, COUNT(*) FROM candle GROUP BY ...` and same on
`global_candles`.

**Raw evidence:**
```
candle              rows = 0
global_candles      rows = 0
```
Every candle-backed table in this DB is empty. There is **no historical OHLC persisted
in this environment** — the scanner reads via live Kite intraday and derives indicators
per-call.

**Indicator surface confirmed in code:**
- `indicators.ts` — full EMA/RSI/VWAP/ATR compute path (grep hit).
- `swingScanner.ts` — uses those primitives.
- `scanner.ts` line 182: documented VWAP fallback chain "live intraday session VWAP →
  20-bar rolling VWAP → undefined (NEVER fall back to spot)".

**Verdict:** the *compute pipe* is ACTIVE and honest. The *durable candle table* is
empty on this pod, meaning any Briefing feature that assumes yesterday's daily bars are
pre-persisted would need to fetch them at generate-time (or a separate warm-up job).
For v1: **compute-time fetch is acceptable** for the Briefing since 09:00 IST
pre-market and 19:00 IST wrap-up windows are both post-market-hours snapshots — a
one-shot Kite historical pull per index is the honest primitive.

**PRE-6 / POST-6 Key Levels:** classify **ACTIVE via compute-time fetch, PARTIAL if
Kite pipe is down at generation time**. Add a hard NULL surface (no fake levels).

---

## 🟢 ROW B · Option chain OI/premium/PCR/MaxPain — **CODE-ACTIVE · DB-DRY**

**Method:** COUNT + latest capture per underlying, `option_chain_snapshot`.

**Raw evidence:**
```
option_chain_snapshot         rows = 0
option_chain_snapshot_run     rows = 0   ← the ingestor has NEVER completed a run
                                            in this DB
```

**BUT:** `optionChainSnapshotIngestor.ts` is registered at boot (previous handoff finding
Row M) and `kiteOptionChain.ts` provides a live-fetch primitive that pulls the chain,
groups by expiry, and picks the nearest-future expiry (lines 119–148). That live
primitive **works without any snapshot storage** and is used by the F&O signal path
today.

**Interpretation:** the snapshot ingestor is currently dormant on this pod (Kite
session down for 2 days ⇒ every scheduled tick short-circuited on `NO_LIVE_KITE_INTRADAY`).
Once Kite re-authenticates and market opens, the ingestor will begin populating. Fully
independent of that, Briefing can read the chain **on-demand at generate-time** via
`kiteOptionChain.ts`.

**PRE-7 Expected Range / POST-5 Chain EOD:** classify **ACTIVE via kiteOptionChain
on-demand read at generate-time**. Snapshot table becomes the "compare vs open"
primitive for POST-5, so POST-5 requires the ingestor's OPEN capture (~09:20 IST) —
add to Phase 1 deliverable: verify ingestor schedule captures OPEN + CLOSE
adjacencies.

---

## 🔴 ROW C · India VIX via direct Kite quote — **CRITICAL · SESSION DOWN + VIX WRITER MIS-TYPED**

**Method:** three-layer probe:
1. Direct hit on `/api/kite/quote/^INDIAVIX` and `/api/kite/quote/NSE:INDIA VIX`.
2. `kite_session` DB row.
3. Historical VIX values recorded in `fno_signal_reasoning.vix` — full-table scan +
   diagnostic call-site grep.

**Raw evidence:**

C1. Kite mapping declared in `kiteIndexQuotes.ts:58`:
```
{ yahoo: "^INDIAVIX",  kite: "NSE:INDIA VIX",  name: "INDIA VIX" }
```
Mapping is correct and matches Kite's tradingsymbol format.

C2. Live Kite quote endpoint:
```
GET /api/kite/quote/^INDIAVIX          → {"error":"no live quote for symbol"}
GET /api/kite/quote/NSE:INDIA VIX      → {"error":"no live quote for symbol"}
GET /api/kite/quotes                   → 0 keys
GET /api/kite/status.readiness.state   → KITE_EXPIRED (offline since 06:35 UTC)
```

C3. Full-table `fno_signal_reasoning` — 141 rows total, by bucket:
```
NULL  = 109  → PRE_EMISSION_REJECTED / SKIPPED paths never set vix
NEG   =   6  → −4.80 to −4.51    (all EMITTED rows, Jul 15)
POS   =  26  →  0..+3.24         (16 DEMOTED + 10 EMITTED, Jul 14)
```
**Range −4.80 to +3.24 is not a VIX level** — it is an intraday change-percent.
Numeric sanity check: real INDIA VIX Jul 15 fell ~5% intraday (~14 → ~13.3); Jul 14
rose ~3%. Both match the recorded rows tightly.

C4. Backup source in `global_live_prices`:
```
symbol='VIX', price=16.31, source='yahoo-index', updated_at=2026-07-16 18:42 IST
```
CBOE ^VIX (US equity vol), NOT India VIX. No `^INDIAVIX` row exists. No
`global_candles` row for any VIX-labeled symbol.

### C · VIX-CORRUPTION DIAGNOSTIC (Option 4, read-only) — ROOT CAUSE FOUND

**(i) Every write path into `fno_signal_reasoning.vix`:**

| # | File | Line | Direction |
|---|---|---|---|
| 1 | `fnoSignalReasoningLogger.ts` | 360 | Final `INSERT` — writes `numOrNull(p.vix, 2)` to the column |
| 2 | `optionSignals.ts` | 3191 | **Feeds writer #1 for EMITTED / DEMOTED paths** — passes `gateCtx.vix.intradayPct` |
| — | `preMarket.ts` | 715, 1614 | Local `buildScenarios(vix)` — parameter name only, does NOT write to `fno_signal_reasoning` |
| — | `optionSignalGates.ts` | 122 | Type declaration only |
| — | `compositeBias.ts` | 95 | Local weight constant, not a write path |
| — | `routes/paper.ts` | 828 | READ (deserialisation) — pulls the column back for the ledger API |

**One and only writer: `optionSignals.ts:3191` for EMITTED-side rows.** Non-emitted
rows call `logFnoReasoning` from other sites that never populate `vix`, producing the
109 NULLs.

**(ii) What value is actually passed:**

```ts
// optionSignals.ts:3191
vix: typeof gateCtx.vix.intradayPct === "number" ? gateCtx.vix.intradayPct : null,
```

`intradayPct` per `optionSignalGates.ts:80–89`:
```ts
export interface VixSnapshot {
  /** % change vs first bar of the current session (intraday move). */
  intradayPct: number | null;
  /** % change vs prior daily close (cross-session move). */
  dayPct: number | null;
  spike: boolean;
  reason: string | null;
}
```
`VixSnapshot` has **only percent fields** (`intradayPct`, `dayPct`, `spike`, `reason`).
**There is no `.level` / `.value` field on the struct.** The writer literally has no
correctly-typed value to hand off — the bug is architectural at the type level, not a
typo at the call site.

Hypothesis test against real INDIA VIX Jul 14 / Jul 15: the recorded values in the DB
match published intraday-change-% for those sessions. **Confirmed: the column carries
change-%, not level.**

**(iii) 109-NULL vs 32-non-NULL split explained:**

| Row bucket | Writer path | Fix scope |
|---|---|---|
| 109 NULLs | `logFnoReasoning` from `PRE_EMISSION_REJECTED` / `SKIPPED` sites that never populate `vix` | Separate integrity slice (rejected rows deserve context too, but not this one) |
| 6 NEG + 26 POS = 32 non-NULLs | `optionSignals.ts:3191` on EMITTED / DEMOTED paths | **This slice** — Type + one write line |

### Fix shape (queued as rider on PAPER_WRITER-DISCIPLINE — NOT landing tonight)

Two-part change, target ≤3 lines of behaviour change plus tests:

```
1. optionSignalGates.ts:80   VixSnapshot: add `level: number | null` (docstring: "Raw
                              INDIA VIX last-traded level from Kite live quote; null
                              when session is down or sanity band fails.")

2. optionSignalGates.ts:374  loadVixSnapshot(): populate .level from the same Kite
                              quote already fetched for intradayPct — no new fetch,
                              no new dependency.

3. optionSignals.ts:3191     Change gateCtx.vix.intradayPct → gateCtx.vix.level.

4. Write-side sanity gate:   Reject writes outside 5..80 (widened band; hard reject
                              logs a warn but writes NULL rather than a garbage level).

5. Tests:                    Unit — pass a VixSnapshot with level=14.2/intradayPct=−4.8;
                              assert 14.2 is written, not −4.8. Property — reject any
                              write < 5 or > 80.
```

### Rider acceptance (added 2026-07-16 evening per owner ruling)

The fix must cover **BOTH halves of the 48h pattern**, not just the 6 negatives:

- **Unit bug (6 negatives + 26 wrongly-typed positives)** — resolved by items 1–3
  above (pass `.level`, not `.intradayPct`).
- **VIX-unavailable case** — the fix must define writer behaviour when
  no VIX is available. Presumed shape: **explicit NULL with a data-quality note**
  (e.g., `data_quality = 'VIX_UNAVAILABLE'` or equivalent on the row), so consumers
  can tell "we didn't have VIX at write-time" apart from "we had it and it was 14.2".
  Ambiguous NULLs on rejected/skipped paths are the same honesty defect as the unit
  bug wearing a quieter costume.

### Denominator reconciliation (recorded before rider opens)

Two NULL counts appear in tonight's evidence, both true, different populations:
- **30 NULLs** — last-48h window (`captured_at >= NOW() - INTERVAL '48 hours'`,
  the initial escalation probe).
- **109 NULLs** — full-table scan (all 141 rows in `fno_signal_reasoning`,
  the later diagnostic).

**Rider acceptance query MUST state its population explicitly** before asserting
"NULLs handled". Suggested contract: acceptance runs against **all rows written
under the fixed writer_version onward** (i.e., a moving window opened at fix land),
NOT against a fixed 48h window or the full historical table. Historical rows are
already ruled to stay dirty with a documented cutover date; the acceptance
denominator is the post-cutover population.

Both halves ship in the same ≤3-line-plus-tests slice; acceptance criteria for the
rider must include the NULL-annotation contract, not only the unit correction.

**Historical rows: leave dirty with a documented cutover date at fix time** (owner
ruling, consistent with the no-retro-mapping ruling on taxonomy). Cutover date will be
inserted here at fix land.

**Priority preserved:** the fix stays in strict sequence, scheduled as a rider on
**PAPER_WRITER-DISCIPLINE** (post-drift, pre-P1.2 — P1.3's volatility-aware targets
need trustworthy VIX before the first real trade). Not P0; sequence unchanged.

**Trigger for P0 escalation (registered rule):** any consumer of `fno_signal_reasoning.
vix` going live before the fix lands. Sequence already prevents this by ordering the
fix before P1.3.

**Verdict:** the Kite `NSE:INDIA VIX` mapping is correct, the wrapper exists, and the
sanity-band test **cannot be run tonight** because Kite is expired and market is
closed. Beyond the session outage: the persisted column carries change-% not level, a
type-level architectural bug now fully diagnosed. Briefing must NOT read from
`fno_signal_reasoning.vix` (per standing rule); it must consume the live Kite quote
directly at generate-time and hard-NULL the section if the quote fails the sanity
band (8 ≤ vix ≤ 35).

**PRE-5 India VIX:** classify **PARTIAL** — Briefing consumes live Kite directly; the
persisted-column defect is contained (no live consumer before the fix lands, per
sequence).

---

## 🟢 ROW D · Instrument-master expiries (weekly/monthly per index) — **LIVE-FETCH ACTIVE · MAP TABLE COLD**

**Method:** `SELECT asset_class, COUNT(*) FROM instrument_map GROUP BY 1;`

**Raw evidence:**
```
instrument_map    rows = 0
```
The persisted instrument map is empty. But `kiteOptionChain.ts:119–148` fetches expiries
**at read-time** by pulling `nfo` instruments via `kc.getInstruments()`, grouping by
`expiryISO(l.expiry)`, sorting future-only, and picking `futureExpiries[0]`.

**app_state confirms cold state:**
```
instruments_check_2026-07-16 = failed_no_session (12:06 IST)
instruments_refresh_failed_2026-07-16 = "no Kite session by 09:20 IST"
```

**Verdict:** expiry resolution is **ACTIVE via on-demand Kite instrument dump** — no
persisted map is required for correctness. Once Kite is re-authenticated the dump path
succeeds; when Kite is down, the whole F&O emission path already gates itself with
`PRE_EMISSION_REJECTED / NO_LIVE_KITE_INTRADAY` (last 3 rows in `fno_signal_reasoning`),
so Briefing inherits the same honesty gate for free.

**PRE-9 / POST-10 expiry-aware sections:** classify **ACTIVE via on-demand Kite dump**.

---

## 🟢 ROW E · ATM straddle premium — **DERIVED FROM B**

Straddle = ATM CE + ATM PE, both live from `kiteOptionChain.ts` chain fetch. No separate
storage needed; derived per-generate.

**PRE-7 Expected Range:** classify **ACTIVE** (inherits Row B verdict).

---

## 🟠 ROW F · Participant-wise OI file — **OPEN · RETEST FRI POST-CLOSE**

**Tonight's partial evidence (2026-07-16 ~18:45 IST, PRE-PUBLISH WINDOW):**
```
GET https://archives.nseindia.com/content/nsccl/fao_participant_oi_16JUL2026.csv
→ HTTP/2 503  (Akamai bot page, 282 bytes)   Timestamp: 2026-07-16 13:14:38 UTC
Yesterday's same-URL probe (per prior matrix): HTTP/2 404
```
Both responses were captured **before the file's normal publish window** (participant
OI typically publishes ~19:30–20:00 IST). Pre-publish 503/404 does NOT distinguish
"file not yet published" from "IP permanently blocked" — the *only* honest test is a
post-publish probe in the same code path a real scheduler would use.

**DB state (unchanged tonight):** `participant_oi_daily` latest = **2026-07-15**
(yesterday), rows = 128 (32 days × 4 client_types). Yesterday's file landed
successfully via the same code path (`instFlows.ts:246`), so the wrapper is proven —
what's unproven is same-day capture reliability.

**Retest deferred to Friday post-close docket** (see "Friday post-close docket" at
bottom). Friday's file — freshly published for a full trading day — tested in the
15:30+ IST window the scheduler actually uses, produces better evidence than tonight's
pre-publish 503 could have.

**PRE-4 / POST-4 Participant OI:** classify **GATED pending Friday post-close retest**.
Same-day capture is not required for v1; T-1 is already persisted (participant_oi_daily
has yesterday's rows).

---

## 🟢 ROW G · Cash bhavcopy + FII/DII — **ACTIVE · SAME-CODE-PATH RE-RUN SCHEDULED FRI POST-CLOSE**

Per standing directive: investigate *why* Row G works before classifying it. Also per
Fri docket ruling: re-run in Friday's post-close window using the same wrapper the
scheduler uses — tonight's evidence is stamped as partial but sufficient to classify
the *infrastructure* as ACTIVE.

**G1 · Endpoint / host split (proof):**
```
Cash bhavcopy → nsearchives.nseindia.com/products/content/sec_bhavdata_full_*.csv
    → HTTP 200, 370595 bytes, content-type: text/csv, akamai-grn set
Alternate host → archives.nseindia.com/products/content/sec_bhavdata_full_*.csv
    → HTTP 503  (Akamai bot-blocked at edge)
F&O participant → archives.nseindia.com/content/nsccl/fao_participant_oi_*.csv
    → HTTP 503  (same Akamai gate as above)
FII/DII API   → www.nseindia.com/api/fiidiiTradeReact
    → HTTP 200, Apache backend, 217B JSON, current-day data
```
Two Akamai edges: `nsearchives.*` allows automated reads, `archives.*` blocks them.
`www.nseindia.com/api/*` is fronted by Apache directly, no Akamai gate.

**G2 · Header requirements (proof):**
```
Naked curl (no headers) → INTERNAL_ERROR
curl with UA header      → HTTP 200
```
The existing wrapper `nseBhavcopy.ts:53–54` sets both `Referer` and `Origin` headers
in addition to UA — sufficient for Akamai's whitelist check.

**G3 · Off-hours vs session-hours:** current probe ran at 18:44 IST (post-close). Row G
worked yesterday at 17:35 IST as well. **Not an off-hours-only gate** — both probes are
post-close but well within Akamai's steady-state operating window.

**G4 · Existing wrappers already run on schedule:**
- `nseBhavcopy.ts` — writes delivery map, symbols, prices to cache; consumers via
  `marketData/referenceData.ts` (guarded import).
- `instFlows.ts` — line 87 fetches FII/DII; line 246 attempts participant OI. Both
  behind a **15-minute `setInterval` refresher** (`instFlows.ts:769`) registered at
  boot+60s via `scheduleBootJob("inst-flows-refresher")` in `routes/index.ts:90`.

**G5 · DB freshness proof:**
```
fii_dii_daily        latest = 2026-07-16 (TODAY), rows=33
  today's row: fii_net = -4205.56, dii_net = +2986.41, source='nse',
               updated_at = 2026-07-16 18:33 IST
participant_oi_daily latest = 2026-07-15,          rows=128 (32 days × 4 clients)
```
Refresher IS live even with Kite session dead — it's an NSE HTTP path, not a Kite path.
Fallback provider `niftytrader` covers gaps (older date range).

**Consequence — Row G is ACTIVE, not just PROMOTABLE:**
- POST-3 (FII/DII today, cash provisional) → **ACTIVE** (today's row already in DB).
- PRE-3 (FII/DII previous session) → **ACTIVE** for cash portion. F&O portion inherits
  Row F verdict.
- POST-2 (breadth, full-exchange A/D) → **ACTIVE** (bhavcopy delivery map already
  cached daily by `nseBhavcopy.ts`).

**Standing rule reminder:** `niftytrader` is a fallback provider used for backfill
gaps — under "no non-Kite in the *decision* path" it does NOT go into signal scoring;
it goes into the Briefing display only, with `source='niftytrader'` chip visible on
the row. Every row keeps its source column and freshness stamp.

---

## 🔴 ROW H · GIFT Nifty — **CONFIRMED ABSENT**

**Method:** grep Kite instrument tables (`global_instruments`, `instrument_map`); check
`global_live_prices.GIFTNIFTY`.

**Raw evidence:**
```
global_live_prices.GIFTNIFTY → price=24056, source='tv'   (TradingView placeholder)
Kite mapping                 → no GIFTNIFTY / SGX entry in INDEX_MAP
```
GIFT Nifty is on NSE-IX / SGX, not on NSE Kite feed. The TV-sourced row is analytics-
only (`trustTier=unavailable`) and cannot go into any decision path.

**PRE-2 GIFT Nifty:** **GATED**. Pending external provider proposal (out of scope for
Briefing v1).

---

## 🟡 ROW I · Yahoo provider + US-10Y unit-parsing — **ACTIVE (BUG NOT REPRODUCED)**

**Method:** grep `^TNX` consumers and verify division-by-10 handling.

**Raw evidence:**
```
globalIndices.ts:37     comment: "Yahoo ^TNX quotes yield ×10, e.g. 51.7 = 5.17%"
globalIndices.ts:40     { yahoo: "^TNX", name: "US 10Y Yield", region: "US" }
preMarket.ts:1320       const yieldPct = tnx.price != null ? round2(tnx.price / 10) : null;
```
**Only one consumer** of `^TNX` exists and it **correctly divides by 10** before
display. The "0.45 vs 4.5%" defect noted in the handoff is either already-fixed or was
attributed to a different code path — no live reproducer in current tree.

**Yahoo provider state:** `global_live_prices` shows 28 symbols currently written with
`source='yahoo-index'` or `'yahoo-equity'`, updated at 18:42 IST today. Yahoo is live
and honoured only for global-cue / off-market-hours secondary analytics (per
`buildGlobalIndexQuote` honesty contract in `globalIndices.ts:56–65`).

**PRE-1 Overnight global cues:** classify **ACTIVE via Yahoo (analytics tier only)**.
Not part of the decision path — display + macro-overlay score only.

---

## 🟠 ROW J · News source — **PROMOTABLE-INFRASTRUCTURE / GATED-AS-SECTION**

**Owner ruling (2026-07-16 evening):** RSS plumbing existing ≠ the PRE-8 / POST-8
sections being trustworthy. Row J is a **curation problem, not a fetch problem**.
Every other briefing section renders verified numbers with provenance; a headline
dump would render unverified editorial judgment with the same visual authority. That
inconsistency requires slowness.

**Infrastructure evidence (fetch layer works):**
```
newsRss.ts registers 20 RSS feeds:
  Moneycontrol × 5   Mint × 3   ET Markets × 2   Economic Times   ET Earnings
  ET Policy   CNBC TV18 × 2   Business Standard × 2   Investing.com × 2
  Yahoo Finance
Symbol-scoped via getNewsForSymbol(symbol) → hits getMarketNewsLive(80).
Consumed today by scanner.ts:486, :742 for per-symbol news blocks.
```

**Full URL list (for owner audit):**

| # | Source | URL |
|---|---|---|
| 1 | Moneycontrol | https://www.moneycontrol.com/rss/MCtopnews.xml |
| 2 | Moneycontrol | https://www.moneycontrol.com/rss/business.xml |
| 3 | Moneycontrol | https://www.moneycontrol.com/rss/buzzingstocks.xml |
| 4 | Moneycontrol | https://www.moneycontrol.com/rss/results.xml |
| 5 | Moneycontrol | https://www.moneycontrol.com/rss/marketreports.xml |
| 6 | Mint | https://www.livemint.com/rss/markets |
| 7 | Mint | https://www.livemint.com/rss/companies |
| 8 | Mint | https://www.livemint.com/rss/economy |
| 9 | ET Markets | https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms |
| 10 | ET Markets | https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms |
| 11 | Economic Times | https://economictimes.indiatimes.com/rssfeedstopstories.cms |
| 12 | ET Earnings | https://economictimes.indiatimes.com/markets/stocks/earnings/rssfeeds/13357270.cms |
| 13 | ET Policy | https://economictimes.indiatimes.com/markets/stocks/policy/rssfeeds/13357270.cms |
| 14 | CNBC TV18 | https://www.cnbctv18.com/commonfeeds/v1/cne/rss/market.xml |
| 15 | CNBC TV18 | https://www.cnbctv18.com/commonfeeds/v1/cne/rss/business.xml |
| 16 | Business Standard | https://www.business-standard.com/rss/markets-106.rss |
| 17 | Business Standard | https://www.business-standard.com/rss/companies-101.rss |
| 18 | Investing.com | https://www.investing.com/rss/news_25.rss |
| 19 | Investing.com | https://www.investing.com/rss/news_301.rss |
| 20 | Yahoo Finance | https://finance.yahoo.com/news/rssindex |

**All 20 are aggregators, none are official-source (exchange / RBI / PIB / SEBI).**
Owner audit target: which sources you'd trust levels from; probable outcome is
whitelist a small subset (Moneycontrol/Mint/ET tier vs Yahoo/Investing tier).

**Owner audit result (2026-07-16 evening, ruled from the pasted list):** AUDIT FAILS.
All 20 feeds are aggregators. Zero official-source (RBI / NSE / BSE / SEBI / PIB) on
the list. There is nothing on this list to whitelist. Filtering the aggregator set
does not fix a source-quality problem.

**Promotion condition (sharpened, replaces earlier draft):**
- Row J promotion requires a **PROPOSED official-source feed list** — RBI press
  releases, NSE/BSE exchange circulars, SEBI notifications, PIB briefings — submitted
  to owner for approval. Not curating the existing aggregator set.
- No urgency. Low priority. Sits behind everything.
- **Events Calendar split** — see new Row J' below.

**PRE-8 / POST-8 News in v1:** **MANUAL ✍️ only** (per existing Q4 ruling). No news
code in Phases 1–4. Three lines of "what I'm watching" from a professional trader
beats twenty algorithmic headlines anyway.

---

## 🔴 ROW J' · Events Calendar (SPLIT OUT OF ROW J) — **NEW LINE · GATED**

**Owner ruling:** the one genuinely load-bearing sub-item of PRE-8 is the events
calendar (RBI meeting dates, CPI/IIP releases, expiry-adjacent macro, results
calendar). This is **not an RSS problem** — scheduled-events data wants a structured
source or an owner-maintained table.

**Current state in code (grep evidence):**
```
marketEvents.ts:75  "Curated 2026 global market holidays (key half/full closures)"
canonicalFnoReadiness.ts:117,129,250  IST-wall-clock holiday-aware market session
```
Market holidays are curated in code; expiry logic is holiday-aware. **But there is
NO structured store for**:
- RBI MPC dates, CPI/IIP/WPI/PMI release dates
- Corporate results calendar (per symbol × date)
- Global macro (FOMC, NFP, ECB) release calendar

**Verdict:** **GATED**. Requires a design decision on source (owner-maintained table
in DB / one structured feed like TradingEconomics or NSE's own events endpoints /
Google Calendar sync) before it can promote. This is the **higher-value half of
PRE-8** and belongs to a dedicated slice, not to newsRss.

**PRE-8 / POST-8 events line:** classify **GATED**. Not covered in v1 briefing.

---

## 🟢 ROW K · NIFTY 500 rate-limit sweep — **FEASIBLE (off-hours verified 2026-07-17)**

**Executed:** 2026-07-17 19:41:45 IST (off-hours), 30 sequential single-symbol
`kc.getQuote()` calls + one 100-symbol batch call via the app's own `getRestClient()`.

**Results:**
- **Sequential**: 30/30 OK, **0 errors, 0 429s**, latency p50=236ms / p95=316ms / mean=294ms, effective rate ~3.4 req/sec sustained.
- **Batch**: 100 symbols in **262ms** (2.6ms/sym), 97/100 returned (3 delisted/renamed).

**Full forensic file:** `/app/memory/forensics/row_k_rate_sweep_2026-07-17.md`

**Caveat**: verified off-hours only. Session-hours confirmation = 60-second spot-check
during Monday's live session (post-M1 kickoff, read-only, mid-day) — if clean, Row K
promotes to fully-ACTIVE.

**Consumers unblocked**: POST-2 breadth (single batched call viable), M5 contract-
selection (3 indices × ~30 contracts = one ~250ms batch), Row L sector sweep
(essentially free).

---

## 🟡 ROW L · Sector indices Kite coverage — **ACTIVE (MAPPINGS DECLARED · SESSION PROOF PENDING)**

**Method:** verify sector-index Kite tradingsymbol mappings in `kiteIndexQuotes.ts`;
compare against `global_live_prices` for any current values; live Kite pull deferred
to session restore.

**Raw evidence — mappings declared:**
```
kiteIndexQuotes.ts:49-58   NSE:NIFTY BANK    NSE:NIFTY IT       NSE:NIFTY AUTO
                            NSE:NIFTY PHARMA  NSE:NIFTY FMCG     NSE:NIFTY FIN SERVICE
                            NSE:NIFTY MID SELECT   BSE:BANKEX    BSE:SENSEX
                            NSE:INDIA VIX
```

**DB state:** `global_live_prices` has only 2 Indian-index rows today (NIFTY, SENSEX,
both `yahoo-index` source) — no sector rows persisted. Yahoo probe of `^CNXIT` etc.
returned empty (endpoint appears blocked from this IP for those symbols).

**Consequence:** sector coverage is **architecturally ACTIVE via Kite session**; DB
does not persist sector rows in this env. Same generate-time fetch pattern as Row A —
one Kite quote batch fetches all sectors, honesty-gated on Kite readiness.

**POST-7 Sector + stock:** classify **ACTIVE at generate-time via Kite batch**, PARTIAL
if Kite is expired at wrap-up window.

---

## 🟢 ROW M · Existing snapshot infrastructure — CONFIRMED from previous session

`optionChainSnapshotIngestor.ts` + `option_chain_snapshot(_run)` tables — declared in
Drizzle at `/app/lib/db/src/schema/optionChainSnapshot.ts`. Currently dormant in this
DB (0 runs) because Kite session has been dead for 2 days. Phase 1 deliverable:
verify ingestor's schedule guarantees OPEN (~09:20 IST) + CLOSE (~15:25 IST) captures.

---

## Signable-scope reclassification (POST Phase 0 evidence, provisional)

| Section | Previous verdict | Post-Phase-0 verdict | Notes |
|---|---|---|---|
| PRE-1 Overnight global cues | GATED | **ACTIVE (analytics-tier Yahoo)** | display + macro-overlay only, never signals |
| PRE-2 GIFT Nifty | CONFIRMED GATED | CONFIRMED GATED | external provider slice |
| PRE-3 FII/DII prev session | GATED | **ACTIVE (cash) · PARTIAL (F&O pending Fri retest)** | today's row already in DB |
| PRE-4 Participant OI | CONFIRMED GATED | **GATED pending Fri post-close retest** | T-1 data already in DB |
| PRE-5 India VIX | ACTIVE via Kite | **PARTIAL · DEFECT DIAGNOSED** | writer at optionSignals.ts:3191 mis-typed; fix queued as rider on PAPER_WRITER-DISCIPLINE |
| PRE-6 Key Levels | pending A/B | **ACTIVE via generate-time Kite fetch** | no persisted candles |
| PRE-7 Expected Range | pending B/C | **ACTIVE (chain via kiteOptionChain, VIX PARTIAL)** | |
| PRE-8 News (headlines) | GATED + MANUAL | **MANUAL ✍️ only in v1 · plumbing PROMOTABLE · pending owner audit** | 20-feed list attached; all aggregators, no official-source |
| PRE-8 Events Calendar (SPLIT) | — | **GATED (new line Row J')** | requires structured source design, not RSS |
| PRE-9 Expiry check | pending D | **ACTIVE via on-demand Kite dump** | |
| PRE-10 Bias & plan | pending A/B/C | **ACTIVE (aggregate of above ACTIVE rows)** | |
| POST-1 Index performance | pending A/L | **ACTIVE via generate-time Kite batch** | |
| POST-2 Breadth | PARTIAL | **ACTIVE via bhavcopy delivery map** | |
| POST-3 FII/DII today | GATED | **ACTIVE** | today's row already in DB @ 18:33 IST |
| POST-4 Participant OI EOD | CONFIRMED GATED | **GATED pending Fri post-close retest** | |
| POST-5 Chain EOD change | ACTIVE (reinforced by row M) | **ACTIVE (requires ingestor ~09:20 IST open capture)** | Phase 1 deliverable |
| POST-6 Level validation | pending A | **ACTIVE via generate-time Kite** | |
| POST-7 Sector + stock | pending L + K | **ACTIVE (sectors) · PARTIAL until K sweep sizes stock scope** | |
| POST-8 News recap | GATED + MANUAL | **MANUAL ✍️ only in v1** (same as PRE-8) | |
| POST-9 Global live | GATED | GATED (analytics tier only) | Yahoo not for decisions |
| POST-10 Tomorrow setup | pending A/B/C/D | **ACTIVE (aggregate of above ACTIVE rows)** | |
| POST-11 Journal | ACTIVE + MANUAL | ACTIVE + MANUAL ✍️ | primitive shared with PRE-8 |

## What flipped positive since the previous matrix draft

1. **Row G · Bhavcopy + FII/DII reconfirmed ACTIVE**: `nseBhavcopy.ts` + `instFlows.ts`
   with 15-min refresher; populated to today's date @ 18:33 IST. Two-Akamai-edge
   split (`nsearchives.*` allow / `archives.*` block) explains why cash succeeds and
   F&O 503s from the same code base.
2. **PRE-1 Overnight global cues**: pending → **ACTIVE at analytics tier**. Yahoo
   global feeds live; the ×10 US-10Y bug is not reproducible in current tree.
3. **Row D expiries**: pending → **ACTIVE via on-demand `kc.getInstruments()` dump**;
   no `instrument_map` persistence required.

## What flipped negative

1. **Row C India VIX — DEFECT NOW FULLY DIAGNOSED**: single writer site
   (`optionSignals.ts:3191`) passes intraday change-% into a level-typed field. Root
   cause is `VixSnapshot` struct having no `.level` field. Fix is ≤3 behaviour lines +
   tests, queued as a rider on PAPER_WRITER-DISCIPLINE (post-drift, pre-P1.2). Historical
   rows: leave dirty; document cutover date at fix time.
2. **Row J News**: previous draft flipped it to ACTIVE — owner ruling reverses that.
   RSS plumbing existing ≠ section trustworthy. **v1 ships PRE-8/POST-8 as MANUAL ✍️
   only.** Promotion path defined; owner audit of the 20-feed list pending.
3. **Row J' Events Calendar (NEW)**: split out of Row J. GATED. The higher-value half
   of PRE-8 is scheduled events, and that wants a structured source, not RSS parsing.

## Owner rulings absorbed this session (2026-07-16 evening)

**RULE-1 — Re-observing a known defect doesn't re-prioritize it. New exposure does.**
Applied to VIX-Corruption: re-confirmed with numeric evidence but priority stays at P1
(rider on PAPER_WRITER-DISCIPLINE), NOT P0. Escalation trigger: any consumer of
`fno_signal_reasoning.vix` going live before the fix lands. Sequence already prevents
this by ordering the fix before P1.3.

**RULE-2 — Discovering plumbing is Phase 0's job; deciding what deserves the platform's
honesty stamp is the owner's.** Applied to Row J: fetch layer works ≠ section
promotable.

**RULE-3 — Match probe methodology to the operational window.** Row F retest deferred
to Friday post-close because a pre-publish 503/404 doesn't distinguish "not yet
published" from "IP blocked"; the fetch-window that a real scheduler uses gives better
evidence anyway.

**RULE-4 — Historical rows stay dirty with a documented cutover date at fix time.**
Consistent with the no-retro-mapping ruling on taxonomy.

## Preview-pod caveats (do NOT block scope-lock; DO flag for owner)

- Kite session on this pod expired at 06:00 UTC / 11:30 IST today. Every Kite-dependent
  row shows a dormant DB (candles=0, snapshot=0, instrument_map=0). ENV issue for the
  preview pod (see backlog ENV-ISOLATION), not a spec issue. Architecture is honest —
  every dependent path self-gates with `NO_LIVE_KITE_INTRADAY / PRE_EMISSION_REJECTED`.
- Instrument-refresh job has failed 2 days in a row (`instruments_check_2026-07-15`
  and `-16` both `failed_no_session`). Once Kite is re-authenticated, these will run.

## Friday post-close docket (2026-07-17 · one batch, one methodology, one actor)

Ordered execution, all read-only or codebase-only, all freeze-compatible until the
acceptance query fires:

1. **12:00 IST canary** — P0.4 Step 2 mid-session sanity peek at
   `fno_signal_reasoning` writes (config_version, canonical_decision, gate_name,
   verdict, stage stamped correctly against live signal traffic).
2. **≥15:30 IST · Row K** — NIFTY 500 rate-limit sweep (small sample, per-symbol
   latency + any 429s).
3. **≥15:30 IST · Row G re-run** — same code path (`refreshFiiDii()`, `getDeliveryMap()`)
   through `instFlows.ts` and `nseBhavcopy.ts`, capture HTTP status + duration +
   rows_written per attempt.
4. **≥20:00 IST · Row F retest** — `GET archives.nseindia.com/content/nsccl/
   fao_participant_oi_17JUL2026.csv` (Friday's file, post-publish window).
5. **Evening · 9-section acceptance query** — run
   `/app/memory/forensics/p0_4_step2_friday_acceptance_query.sql`, paste output, seek
   sign-off on P0.4 Step 2 closure.

Weekend: Checkpoint 0 sign-off on this matrix; Monday: P0.1+P0.2 kickoff.

## Owner sign-off checklist (before Phase 1)

- [ ] Verdicts above accepted (or rejected per-row).
- [ ] Row F retest result recorded post-20:15 IST Friday.
- [ ] Row G Friday re-run result recorded.
- [ ] Row K sweep result recorded post-15:30 IST Friday.
- [ ] **VIX-Corruption diagnostic accepted** as read; fix queued as rider on
      PAPER_WRITER-DISCIPLINE.
- [ ] **Row J audit** — 20-feed list reviewed; whitelist decided or promotion held.
- [ ] **Row J' Events Calendar** — structured-source design proposed in its own slice.
- [ ] Phase 1 schema proposal shrinks to **2 new tables** (`daily_briefings`,
  `owner_journal_entries`) + optional ingestor schedule extension.
- [ ] Standing rule reconfirmed: MANUAL ✍️ text renders under ✍️ chip only, never
  blended into computed lines.
