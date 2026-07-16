# Phase 0 · Data Availability Matrix — READ-ONLY EVIDENCE

**Owner ruling registered:** today is **Thursday 16 July 2026**. Acceptance query runs
Friday evening (17 July), not tonight. Row K post-15:30 IST sweep = tomorrow. Row F
retest after 20:00 IST tonight (participant files publish late).

**Environment note:** this pod's Kite session **expired at 06:00 UTC / 11:30 IST today**
(`kite_session.expires_at = 2026-07-16 06:00 IST`), and `app_state.kite_offline_since =
2026-07-16T06:35:43Z`. `instruments_check_2026-07-16 = failed_no_session`. Every row
that depends on a live Kite pull is currently probed with the pipe cold; the code path
and DB state are used as evidence in place of a live REST reply.

**Status:** Rows A/B/C/D/E/G/H/I/J/L probed with pasted evidence. Rows F (retest
post-20:00 tonight) and K (post-15:30 IST Friday) remain scheduled. Signable
reclassification below is provisional until F and K land.

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

## 🔴 ROW C · India VIX via direct Kite quote — **CRITICAL · SESSION DOWN + VIX DATA CORRUPT**

**Method:** three-layer probe:
1. Direct hit on `/api/kite/quote/^INDIAVIX` and `/api/kite/quote/NSE:INDIA VIX`.
2. `kite_session` DB row.
3. Historical VIX values recorded in `fno_signal_reasoning.vix` over last 48h.

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

C3. Historical VIX values written to `fno_signal_reasoning.vix` last 48h:
```
total=36  null=30  negatives=6  impl_low=0  sane(8–35)=0  above_35=0
min_vix=-4.80  max_vix=-4.51  avg_vix=-4.702
```
**Every single non-NULL VIX value in the last 48h is NEGATIVE.** This is the
`VIX-Corruption` P1 issue (previously anecdotal) now proven with numeric evidence.

C4. Backup source in `global_live_prices`:
```
symbol='VIX', price=16.31, source='yahoo-index', updated_at=2026-07-16 18:42 IST
```
This is **CBOE ^VIX (US equity vol), NOT India VIX.** No `^INDIAVIX` row exists.
No `global_candles` row for any VIX-labeled symbol.

**Verdict:** the Kite `NSE:INDIA VIX` mapping is correct, the wrapper exists, and the
sanity-band test **cannot be run tonight** because Kite is expired and market is
closed. Beyond the session-outage: **the last 6 non-NULL VIX writes to
`fno_signal_reasoning` are all negatives (–4.80 to –4.51)** — a numeric-scale defect
that must be fixed before this column is trusted anywhere. Root-cause investigation
is a separate slice (issue #4 VIX-Corruption).

**PRE-5 India VIX:** classify **PARTIAL** — architecturally ACTIVE via Kite, but the
observed historical column carries a sign/scale defect and current session is expired.
Briefing must NOT read from `fno_signal_reasoning.vix` (per standing rule); it must
consume the live Kite quote directly at generate-time and hard-NULL the section if the
quote fails the sanity band (8 ≤ vix ≤ 35).

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

## 🔴 ROW F · Participant-wise OI file — **RETEST DEFERRED TO POST-20:00 IST TONIGHT**

**Today's probe:**
```
GET https://archives.nseindia.com/content/nsccl/fao_participant_oi_16JUL2026.csv
→ HTTP/2 503  (Akamai bot page, 282 bytes)
```
Note: **yesterday's Phase 0 evidence** captured this same URL as 404. Today it is 503.
Both are Akamai edge gates — the *file itself* has not published for today's session
(participant OI publishes late in the evening, typically 19:30–20:00 IST).

**DB state confirms:** `participant_oi_daily` latest = **2026-07-15** (yesterday), 4
client_types × 32 days = 128 rows. Yesterday's data landed successfully.

**Retest at ~20:15 IST tonight** to determine if:
- Today's file publishes at ≥20:00 IST → HTTP 200 → Row F flips to ACTIVE via same
  Akamai path.
- File never publishes / 503 persists → Row F stays GATED, and the interpretation-per-
  participant differentiator is unlockable via a later slice.

**PRE-4 / POST-4 Participant OI:** classify **GATED pending post-20:00 retest**. Same-
day capture is not required for v1; T-1 is already persisted (participant_oi_daily
has yesterday's row set).

---

## 🟢 ROW G · Cash bhavcopy + FII/DII — **ACTIVE (WHY-INVESTIGATION COMPLETED)**

Per standing directive: investigate *why* Row G works before classifying it.

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

## 🟢 ROW J · News source — **ACTIVE (previous "no trusted source" ruling was inaccurate)**

**Method:** grep news providers.

**Raw evidence:**
```
newsRss.ts registers 20 RSS feeds:
  Moneycontrol × 5   Mint × 3   ET Markets × 2   Economic Times   ET Earnings
  ET Policy   CNBC TV18 × 2   Business Standard × 2   Investing.com × 2
  Yahoo Finance
Symbol-scoped news via getNewsForSymbol(symbol) → hits getMarketNewsLive(80).
Consumed by scanner.ts:486, :742 for per-symbol news blocks.
```

**Consequence:** PRE-8 / POST-8 news sections can use `getMarketNewsLive()` as a real
data source, not a MANUAL placeholder. **The MANUAL ✍️ primitive stays** (per Q4
ruling) for owner-authored morning notes and evening journal — text field UX unchanged.
The **News section itself upgrades from GATED → ACTIVE (RSS-fed).**

Freshness contract: each `NewsItem` carries `pubDate` from RSS; freshness gate = drop
items older than 12h in the pre-market strip and older than 24h in the wrap-up
strip. Never blended into computed lines.

**PRE-8 / POST-8:** classify **ACTIVE (RSS)** with MANUAL ✍️ still mounted alongside.

---

## 🟠 ROW K · NIFTY 500 rate-limit sweep — **DEFERRED TO POST-15:30 IST FRIDAY**

Not probed tonight. Ruling reaffirmed: shares Kite session with signal generation; run
sweep only after market close tomorrow, small-sample cap, capture per-symbol latency
distribution + any 429s.

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
| PRE-3 FII/DII prev session | GATED | **ACTIVE (cash) · PARTIAL (F&O pending row F retest)** | today's row already in DB |
| PRE-4 Participant OI | CONFIRMED GATED | GATED pending 20:00 IST retest | T-1 data already in DB |
| PRE-5 India VIX | ACTIVE via Kite | **PARTIAL · DEFECT** | direct-Kite pipe correct; historical column corrupt (negatives) |
| PRE-6 Key Levels | pending A/B | **ACTIVE via generate-time Kite fetch** | no persisted candles |
| PRE-7 Expected Range | pending B/C | **ACTIVE (chain via kiteOptionChain, VIX PARTIAL)** | |
| PRE-8 News | GATED + MANUAL | **ACTIVE (RSS) + MANUAL ✍️** | 20 Indian feeds registered |
| PRE-9 Expiry check | pending D | **ACTIVE via on-demand Kite dump** | |
| PRE-10 Bias & plan | pending A/B/C | **ACTIVE (aggregate of above ACTIVE rows)** | |
| POST-1 Index performance | pending A/L | **ACTIVE via generate-time Kite batch** | |
| POST-2 Breadth | PARTIAL | **ACTIVE via bhavcopy delivery map** | |
| POST-3 FII/DII today | GATED | **ACTIVE** | today's row already in DB @ 18:33 IST |
| POST-4 Participant OI EOD | CONFIRMED GATED | GATED pending 20:00 IST retest | |
| POST-5 Chain EOD change | ACTIVE (reinforced by row M) | **ACTIVE (requires ingestor ~09:20 IST open capture)** | Phase 1 deliverable |
| POST-6 Level validation | pending A | **ACTIVE via generate-time Kite** | |
| POST-7 Sector + stock | pending L + K | **ACTIVE (sectors) · PARTIAL until K sweep sizes stock scope** | |
| POST-8 News recap | GATED + MANUAL | **ACTIVE (RSS) + MANUAL ✍️** | |
| POST-9 Global live | GATED | GATED (analytics tier only) | Yahoo not for decisions |
| POST-10 Tomorrow setup | pending A/B/C/D | **ACTIVE (aggregate of above ACTIVE rows)** | |
| POST-11 Journal | ACTIVE + MANUAL | ACTIVE + MANUAL ✍️ | primitive shared with PRE-8 |

## What flipped positive since the previous matrix draft

1. **PRE-8 / POST-8 News**: GATED → **ACTIVE via `newsRss.ts` (20 Indian RSS feeds)**.
   Previously assumed "no trusted news source" — that ruling was based on incomplete
   grep. `getMarketNewsLive(count)` is live and consumed by scanner.
2. **PRE-1 Overnight global cues**: previously pending → **ACTIVE at analytics tier**
   (Yahoo global feeds are live; the ×10 US-10Y bug is not reproducible in current tree).
3. **Row G reconfirmed ACTIVE**: cash bhavcopy + FII/DII both wired through
   `nseBhavcopy.ts` + `instFlows.ts` with a 15-min refresher and populated to today's
   date @ 18:33 IST. The `nsearchives.*` vs `archives.*` Akamai split is the exact
   reason cash works and F&O 503s.
4. **Row D expiries**: pending → **ACTIVE via on-demand `kc.getInstruments()` dump**;
   no `instrument_map` persistence required.

## What flipped negative

1. **Row C India VIX**: architecturally ACTIVE → **PARTIAL / DEFECT** — the historical
   `fno_signal_reasoning.vix` column contains only NULLs and negatives (–4.80 to –4.51)
   over the last 48h. Kite mapping is correct; live pull deferred to session restore
   with a hard 8–35 sanity band as the honesty gate. **`VIX-Corruption` upgraded from
   anecdotal P1 to numerically-proven P1.**

## Preview-pod caveats (do NOT block scope-lock; DO flag for owner)

- Kite session on this pod expired at 06:00 UTC / 11:30 IST today. Every Kite-dependent
  row shows a dormant DB (candles=0, snapshot=0, instrument_map=0). This is an ENV
  issue for the preview pod (see backlog ENV-ISOLATION), not a spec issue. The
  architecture is honest — every dependent path already gates itself with
  `NO_LIVE_KITE_INTRADAY / PRE_EMISSION_REJECTED`.
- The instrument-refresh job has failed 2 days in a row (`instruments_check_2026-07-15`
  and `-16` both `failed_no_session`). Once Kite is re-authenticated, these will run.

## Remaining tonight

- **~20:15 IST** — Row F retest against `archives.nseindia.com/content/nsccl/
  fao_participant_oi_16JUL2026.csv`. If 200, participant OI flips to ACTIVE for
  same-day; if still 503/404, Row F stays GATED and PRE-4/POST-4 remain gated in v1.

## Owner sign-off checklist (before Phase 1)

- [ ] Verdicts above accepted (or rejected per-row).
- [ ] Row F retest result recorded post-20:15 IST tonight.
- [ ] Row K sweep result recorded post-15:30 IST Friday.
- [ ] `VIX-Corruption` scheduled as its own P1 slice (blocks PRE-5/POST-6 hard trust).
- [ ] Phase 1 schema proposal shrinks to **2 new tables** (`daily_briefings`,
  `owner_journal_entries`) + optional ingestor schedule extension.
- [ ] Standing rule reconfirmed: MANUAL ✍️ text renders under ✍️ chip only, never
  blended into computed lines.
