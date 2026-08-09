# Coder Task — Dual-Model Next-Day Directional Scorer (NIFTY / BANKNIFTY / SENSEX)

## Context & authority
You are implementing a new feature in the Market Scanner monorepo. Owner has approved this
spec. Follow all standing platform rules. This is a **bias-filter analytics feature**, not a
trade-signal lane — it must never write to any signal/execution table.

## Non-negotiable rules (bright lines — binary pass/fail)
1. **Schema is additive-only.** New tables only, or `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
   No drops, no renames, no type changes on existing columns. Apply via direct SQL (drizzle-kit
   push is unreliable for this repo). PASS = zero destructive statements in the migration.
2. **No fabrication / fail closed.** If any of the 9 factor inputs for an index is missing at
   scoring time, that factor scores `null` (NOT 0), the index's scorecard is marked
   `coverage: "PARTIAL"` with the list of missing factors, and the verdict is suppressed to
   `INSUFFICIENT_DATA`. Never substitute 0 for missing. PASS = a missing-input test yields
   `INSUFFICIENT_DATA`, never a numeric verdict.
3. **Route off synthetic-futures spot, not the CAS cash close.** Price-action (F3) and all
   realized-direction grading read the synthetic-futures spot the platform already derives.
   If synthetic spot is unavailable for an index, F3 = `null` and grading for that session is
   deferred (status `AWAITING_SPOT`), never graded off cash. PASS = grading job refuses to run
   on cash-only data.
4. **Do NOT touch** `replit.md`, any file in the data-honesty layer (TradeableBrand /
   assertTradeable / import-allowlist), or any signal/execution code path.
5. **No adjacent/unprompted work.** Build exactly what is listed under Deliverables. If you
   believe something else is needed, STOP and report it — do not implement it.

## Feature summary
Two models score the same 9 directional factors for each of the 3 indices independently;
factor 10 is a non-scoring event gate. Results are logged nightly and graded the next session
against synthetic-futures close-to-close with a per-index neutral band. A per-index hit-rate
scoreboard shows which model earns its weights over time.

## Data model (new tables — additive)
```
directional_factor_score      -- one row per (session_date, index, factor_id)
  session_date DATE
  index_symbol VARCHAR(16)     -- 'NIFTY' | 'BANKNIFTY' | 'SENSEX'
  factor_id VARCHAR(8)         -- 'f1'..'f9'
  direction SMALLINT NULL      -- -1 | 0 | 1 | NULL(=missing, fail-closed)
  source_note VARCHAR(255)     -- provenance of the input (which feed/derivation)
  created_at TIMESTAMPTZ DEFAULT now()

directional_scorecard         -- one row per (session_date, index)
  session_date DATE
  index_symbol VARCHAR(16)
  bal_score SMALLINT NULL      -- Model A, -100..100, NULL if suppressed
  wtd_score SMALLINT NULL      -- Model B
  bal_verdict VARCHAR(24)      -- see verdict enum
  wtd_verdict VARCHAR(24)
  coverage VARCHAR(8)          -- 'FULL' | 'PARTIAL'
  missing_factors VARCHAR(64)  -- csv of factor_ids, '' if none
  gate_armed BOOLEAN
  gate_reasons VARCHAR(128)    -- csv: binary|pin|cas|shock
  status VARCHAR(20)           -- 'SCORED' | 'INSUFFICIENT_DATA' | 'GATED_NO_TRADE'

directional_outcome           -- graded next session
  session_date DATE
  index_symbol VARCHAR(16)
  realized_dir VARCHAR(8)      -- 'up'|'down'|'flat'|'AWAITING_SPOT'
  synth_ret_pct NUMERIC(6,3)   -- synthetic-futures close-to-close %
  neutral_band_pct NUMERIC(5,3)-- band used, for audit
  intraday_favorable BOOLEAN   -- did a defined-risk spread hit target intraday
  bal_grade VARCHAR(8)         -- 'hit'|'miss'|'avoid'|'skip'|NULL
  wtd_grade VARCHAR(8)
```
Verdict enum: `STRONG_BULL, MILD_BULL, NO_EDGE, MILD_BEAR, STRONG_BEAR, NO_TRADE, INSUFFICIENT_DATA`.

## Scoring logic
Implement per the reference module `directionalScorer.ts` (delivered alongside this prompt).
Do not re-derive the weights or bands — import them from a single `SCORER_CONFIG` const so
they are tunable in one place. Per-index neutral bands live in that config.

## Grading job (nightly / pre-open)
- Runs after synthetic-futures close is finalized (NOT before 15:15 cash; use synthetic).
- For each scored index: `synth_ret_pct = (synth_close_today - synth_close_prev)/synth_close_prev * 100`.
- `realized_dir = up if > band, down if < -band, else flat`. If synthetic close missing →
  `AWAITING_SPOT`, grade deferred.
- Grade: directional verdict → `hit` if dir matches realized, else `miss`.
  `NO_EDGE`/`NO_TRADE`/`INSUFFICIENT_DATA` → `avoid` if realized=flat, else `skip`.
  `avoid`/`skip` NEVER count in hit-rate numerator or denominator.

## UI
- One page, **index filter tab** (NIFTY / BANKNIFTY / SENSEX) — selecting one shows that
  index's factor scorer, both verdict cards, and that index's own scoreboard. No blending.
- Reuse platform components: GlobalStatusBanner for coverage, existing MarketBias styling.
- Coverage label always visible; `PARTIAL` shows missing factors explicitly.
- Scoreboard per index: Model A hit-rate, Model B hit-rate, graded-session count, and an
  explicit "sample insufficient (<30)" state — do not show a confident % below 30 graded calls.

## Deliverables (and nothing else)
1. Migration SQL (additive) for the 4 tables above.
2. `directionalScorer.ts` wired to `SCORER_CONFIG` (use delivered reference).
3. Nightly grading job.
4. One UI page with the 3-index filter tab + per-index scoreboards.
5. Tests: (a) missing-input → INSUFFICIENT_DATA; (b) gate armed → GATED_NO_TRADE regardless
   of score; (c) conviction override fires only when f1==f2!=0; (d) avoid/skip excluded from
   hit rate; (e) grading refuses cash-only data.

## Acceptance criteria (binary)
- [ ] Migration contains zero destructive statements.
- [ ] Missing any factor input yields INSUFFICIENT_DATA, never a numeric verdict.
- [ ] Gate armed forces NO_TRADE for both models at any score.
- [ ] Grading uses synthetic spot; refuses to grade on cash-only.
- [ ] Each index has an independent scoreboard; no blended hit rate exists anywhere.
- [ ] Hit rate excludes avoid/skip from both numerator and denominator.
- [ ] Full monorepo typecheck GREEN. Tests run in Replit Shell tab (not bash agent).

---

## Input mapping — wire the 9 factors to EXISTING page data (fill this in against the repo)

The scorer must NOT recompute participant OI, PCR, VIX, etc. Those already exist on the
pre/post page. Your job is to **read** each factor's raw value from the existing service/field,
apply the classification rule below to derive the −1/0/+1 direction, and pass it into
`scoreIndex()`. Do not fabricate any input. If a source is unavailable/stale for an index,
that factor's direction is `null` (fail-closed) — never 0.

For EACH row: locate the real source in the codebase, record the exact
service/function/field, note the freshness check, and confirm it exists per index
(NIFTY / BANKNIFTY / SENSEX). Leave `<FILL: ...>` blank until verified against the repo —
do NOT guess a source name.

| Factor | Reads (concept already on page) | Existing source (service.fn / table.column) | Per-index? | Freshness guard | Direction rule (→ −1 / 0 / +1) |
|--------|--------------------------------|----------------------------------------------|-----------|-----------------|-------------------------------|
| f1 Participant OI (FII+Pro) | Participant-wise OI panel (the "12.9% net long" surface) | `<FILL: source>` | `<FILL: Y/N per idx>` | `<FILL: max staleness>` | FII long AND Pro long → +1 · both short → −1 · disagree/flat → 0. Full magnitude only on FII+Pro agreement. |
| f2 FII index-futures OI | FII futures long/short + OI change (Index Futures aggregate row) | `<FILL: source>` | `<FILL>` | `<FILL>` | OI↓ & price↑ (covering) or long buildup → +1 · fresh shorts (OI↑ price↓) → −1 · unwind/ambiguous → 0 |
| f3 Price action | Synthetic-futures spot + structure (NOT cash close) | `<FILL: synthetic spot source — REQUIRED, see rule 3>` | `<FILL>` | `<FILL>` | gap fill + support/trendline hold + bullish weekly → +1 · support break / bearish → −1 · indecision → 0. If synthetic spot missing → `null`. |
| f4 Option-chain OI walls | Option Chain Snapshot — CE/PE walls, new-vs-old OI | `<FILL: source>` | `<FILL>` | `<FILL>` | above CE wall / short-cover trigger clears → +1 · rejected at CE wall or below fresh PE → −1 · mid-range → 0 |
| f5 India VIX / IV | India VIX value + trend (the "12.16" tile) | `<FILL: source>` | VIX is single (NIFTY); apply same to BN/SENSEX unless a per-idx IV exists → `<FILL>` | `<FILL>` | falling → +1 · spiking → −1 · stable → 0 |
| f6 PCR (banded) | PCR figure per index | `<FILL: source>` | `<FILL>` | `<FILL>` | 0.9–1.2 & rising → +1 · <0.7 → −1 · >1.6 overheated → −1 · else 0 |
| f7 Commodity/macro | Macro Overlay — crude (lead), DXY, India 10Y | `<FILL: source>` | shared (not per-idx) | `<FILL>` | crude falling (esp <70) → +1 · crude spiking → −1 · flat → 0. DXY/10Y as tie-break only. |
| f8 FII/DII cash | FII/DII cash flow figures | `<FILL: source>` | shared | `<FILL>` | both net buyers → +1 · both net sellers → −1 · mixed → 0 |
| f9 Global cues | Global Indices panel (US close / futures) | `<FILL: source>` | shared | `<FILL>` | US green → +1 · red → −1 · flat → 0 |

### Mapping rules (binary)
- **No recomputation.** If a value is already computed on the page, read that value; do not
  re-derive it in the scorer. PASS = scorer imports/reads existing sources, adds no duplicate
  OI/PCR/VIX math.
- **Per-source fail-closed.** Each mapped source must have an explicit
  availability + freshness check. If it fails, that factor = `null`. PASS = disabling any one
  source in a test yields `INSUFFICIENT_DATA` for that index, not a 0-substituted score.
- **Shared vs per-index is explicit.** f7/f8/f9 are market-wide (same value applied to all
  three indices); f1–f6 must resolve per index. Record which in the table. PASS = f1–f6 pull
  index-specific values; no cross-index bleed.
- **Direction derivation is centralised.** Put the raw→direction classification for each factor
  in one module (e.g. `factorClassifiers.ts`) with unit tests per rule, so thresholds
  (VIX %, PCR bands, crude level) are tunable in one place alongside `SCORER_CONFIG`.
- **Provenance recorded.** Write the resolved source name into `directional_factor_score.source_note`
  for every scored factor, so each input is auditable back to its origin.

### Deliverable addition
6. `factorClassifiers.ts` — one function per factor mapping existing raw value → −1/0/+1/null,
   each fed from the source named in the completed table above, with per-rule unit tests.

### Acceptance criteria addition
- [ ] The mapping table is fully filled (no remaining `<FILL>`), each source verified to exist in the repo.
- [ ] Scorer reads existing values; no duplicate OI/PCR/VIX computation introduced.
- [ ] Disabling any single mapped source → that factor `null` → `INSUFFICIENT_DATA` (never 0-substituted).
- [ ] f1–f6 resolve per index; f7–f9 correctly shared across all three.
- [ ] Every scored factor writes its resolved source into `source_note`.

### STOP condition
If any factor's concept does NOT already exist on the page for a given index (e.g. no per-index
PCR for SENSEX), STOP and report it to the owner. Do NOT invent a substitute source or
backfill a value — surface the gap and await a ruling.

---

# ADDENDUM — Intraday (live-session) mode

The scorer now has TWO modes sharing one engine: `PREPOST` (existing, EOD) and `INTRADAY`
(new, live during market hours). `scoreIndex(inputs, gate, mode, proxyActive, minutesSinceOpen)`
already supports both; weights and grading bands are per-mode in `SCORER_CONFIG`. Build the
intraday mode as an ADDITIVE extension — do not alter pre/post behaviour.

## Owner decisions (locked)
1. **Participant OI (F1/F2) intraday:** NSE publishes the FII/Pro/Client split EOD only.
   Intraday, F1/F2 are served by a **live aggregate OI-change proxy**, and MUST be visibly
   labelled "AGGREGATE PROXY — not participant split." The label is non-negotiable; presenting
   proxy as the real split = fabrication.
2. **Refresh cadence:** every **1 minute** during market hours.
3. **Grading:** **dual** — log BOTH a fixed forward-horizon grade (default +60 min, see
   `SCORER_CONFIG.intraday.forwardHorizonMin`) AND a to-session-close grade. Two hit rates.

## Intraday input mapping (differs from EOD — fill against repo)
Reuse the EOD mapping table where the concept is genuinely live; override these rows:

| Factor | Intraday source (live) | Handling / label | Direction rule |
|--------|------------------------|------------------|----------------|
| f1 | Aggregate option-chain OI change (live) `<FILL>` | **PROXY** — tag `proxyActive`, label in UI | net CE unwind + PE buildup → +1 · opposite → −1 · mixed → 0 |
| f2 | Live index-futures OI change (aggregate) `<FILL>` | **PROXY** — tag `proxyActive` | OI↓ & price↑ (covering) → +1 · fresh shorts → −1 · flat → 0 |
| f3 | Live futures/synthetic tape vs ORB / VWAP / prior-day levels `<FILL>` | dominant intraday weight | above VWAP & ORB-high, holding → +1 · below & losing → −1 · inside range → 0 |
| f4 | Live OI walls (built-today vs at-open) `<FILL>` | — | clears CE wall built today → +1 · rejected / PE wall lost → −1 · mid → 0 |
| f5 | India VIX change-from-prev-close + intraday spike `<FILL>` | — | falling vs prev close → +1 · spiking → −1 · flat → 0 |
| f6 | Intraday PCR (WIDER bands) `<FILL>` | noisier intraday | 0.85–1.25 & rising → +1 · <0.65 → −1 · >1.7 → −1 · else 0 |
| f7 | Crude / global live `<FILL>` | shared | crude falling → +1 · spiking → −1 · flat → 0 |
| f8 | FII/DII cash — **EOD ONLY, STALE intraday** `<FILL>` | **freeze + label 'prev day'** (staleEodFactors) | prev-day both buyers → +1 · both sellers → −1 · else 0 (near-zero weight) |
| f9 | US index futures live during IST session `<FILL>` | shared | US futures green → +1 · red → −1 · flat → 0 |

## Intraday rules (binary)
- **Warmup:** no verdict in the first `warmupMinutes` (15) after open — status stays
  `INSUFFICIENT_DATA`. PASS = a 09:18 IST score returns INSUFFICIENT_DATA, not a number.
- **Proxy labelling:** F1/F2 rows in the intraday UI must render an explicit "AGGREGATE PROXY"
  badge; `directional_factor_score.source_note` records `proxy=true`. PASS = proxy factors are
  never displayed or stored as "participant/FII-Pro split."
- **Stale-EOD labelling:** F8 intraday must show "as of prev close" and use the near-zero
  intraday weight. PASS = intraday F8 never presented as today's cash flow.
- **Cadence + snapshot:** write one `intraday_scorecard` row per (timestamp, index) at 1-min
  cadence during 09:15–15:30 IST; do not overwrite — each minute is an immutable snapshot for
  later grading. PASS = a session yields a time series, not a single mutated row.
- **Dual grade:** each intraday snapshot is graded twice — at +`forwardHorizonMin` and at close —
  using `gradeIntradayDual`, against SYNTHETIC-futures returns only. Either leg may be
  `AWAITING_SPOT` independently. PASS = both grades stored per snapshot; hit rates computed
  separately; avoid/skip excluded from both.

## Additive schema (intraday)
```
intraday_scorecard
  ts TIMESTAMPTZ            -- 1-min snapshot time (IST session)
  session_date DATE
  index_symbol VARCHAR(16)
  minutes_since_open SMALLINT
  bal_score SMALLINT NULL
  wtd_score SMALLINT NULL
  bal_verdict VARCHAR(24)
  wtd_verdict VARCHAR(24)
  coverage VARCHAR(8)
  missing_factors VARCHAR(64)
  proxy_factors VARCHAR(32) -- csv, e.g. 'f1,f2'
  stale_factors VARCHAR(32) -- csv, e.g. 'f8'
  gate_armed BOOLEAN
  status VARCHAR(20)        -- SCORED | INSUFFICIENT_DATA | GATED_NO_TRADE

intraday_outcome
  ts TIMESTAMPTZ            -- matches the snapshot graded
  session_date DATE
  index_symbol VARCHAR(16)
  horizon_min SMALLINT
  fwd_ret_pct NUMERIC(6,3)  -- synthetic return over the forward horizon
  close_ret_pct NUMERIC(6,3)-- synthetic return snapshot->close
  band_pct NUMERIC(5,3)
  bal_grade_horizon VARCHAR(8)  bal_grade_close VARCHAR(8)
  wtd_grade_horizon VARCHAR(8)  wtd_grade_close VARCHAR(8)
```

## UI (intraday)
- Same page, add a **mode toggle: PRE/POST ↔ INTRADAY**. Intraday view shows a "LIVE · updates
  every 1 min" indicator, the current 1-min verdict per index, the proxy/stale badges, and a
  small intraday score sparkline for the session.
- Intraday scoreboard shows TWO hit rates per model: **+60min** and **to-close**, each with its
  own graded-sample count and the <30 "insufficient sample" guard.
- Never show a live verdict during warmup or when any live source is stale — fail closed to
  INSUFFICIENT_DATA with the reason.

## Deliverables (intraday — additive, nothing else)
7. Intraday weights + config already in `SCORER_CONFIG` (delivered); wire the 1-min job.
8. `intraday_scorecard` + `intraday_outcome` tables (additive migration).
9. 1-min snapshot writer (09:15–15:30 IST) + dual-grading job (+horizon and at close).
10. Mode toggle UI + proxy/stale badges + dual-hit-rate scoreboard.
11. Tests: (a) warmup → INSUFFICIENT_DATA; (b) proxy factors flagged+labelled, never stored as
    participant split; (c) stale F8 labelled + near-zero weight; (d) 1-min snapshots immutable
    (time series, not overwrite); (e) dual grade produces two independent grades; (f) intraday
    grading refuses cash-only data.

## Acceptance criteria (intraday — binary)
- [ ] Pre/post mode behaviour is byte-for-byte unchanged (regression test green).
- [ ] Intraday first-15-min scores return INSUFFICIENT_DATA.
- [ ] F1/F2 intraday always carry the AGGREGATE-PROXY label and proxy=true provenance.
- [ ] F8 intraday labelled 'prev day' and uses intraday (near-zero) weight.
- [ ] 1-min snapshots are immutable rows; a session is a time series.
- [ ] Each snapshot graded at +horizon AND at close; two hit rates; avoid/skip excluded.
- [ ] All intraday grading uses synthetic-futures returns; refuses cash-only.
