# Phase 0 · Data Availability Matrix — READ-ONLY EVIDENCE (2026-07-16 evening, ~17:50 IST)

**Status**: In progress. Rows M/F/G/H probed with raw evidence. Rows A/B/C/D/E/I/J/L pending code-inspection or live Kite pulls; Row K pending post-15:30 Friday.

## SCOPE-SHIFT SURPRISES (revise §3 expectations)

### 🟢 ROW M · Existing snapshot infrastructure DISCOVERED — Phase 1 schema shrinks

**`optionChainSnapshotIngestor.ts` is already live in production** and does most of what spec §4's `option_chain_snapshots` table proposed:

| Capability | Evidence |
|---|---|
| Backing tables | `option_chain_snapshot` + `option_chain_snapshot_run` — **BOTH declared in Drizzle** at `/app/lib/db/src/schema/optionChainSnapshot.ts` ✅ NOT in the 8-item drift inventory |
| Coverage | NIFTY, BANKNIFTY, SENSEX (constant `SNAPSHOT_INDICES` line 55) |
| Schedule | `startOptionSnapshotIngestor()` scheduled ticker with `bucketTimestamp(now, intervalMinutes)` — need to verify capture interval + open/close-adjacent guarantees in Phase 1 |
| Retention | `runRetentionSweep()` exists |
| Boot behavior | Fires one tick on boot (no-ops outside market hours), then schedules |
| Write pattern | `db.insert(optionChainSnapshotTable)` at line 218 — clean, no runtime `CREATE TABLE` |

**Consequence**: Phase 1's schema proposal shrinks from **3 new tables → 2 new tables + reuse `option_chain_snapshot`**. The two new tables remain: `daily_briefings` + `owner_journal_entries`.

**Phase 1 additional deliverable** (added to plan): verify the ingestor's schedule guarantees OPEN (~09:20) and CLOSE (~15:25) captures — if not, propose extending its config (additive), not creating a parallel snapshot table.

### 🟢 ROW G · SURPRISE — Cash bhavcopy + FII/DII WORK from prod IP

Spec §2 assumed row G "may be GATED same as F". Live probe from this prod pod:
- **`sec_bhavdata_full_16072026.csv`**: **HTTP 200, 370595 bytes**, CSV parseable (headers SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER). Sample row: `1018GS2026, GS, 16-Jul-2026, ...`
- **`nseindia.com/api/fiidiiTradeReact`**: **HTTP 200**, 217B JSON. Today's numbers: **DII net ₹+2986.41 cr, FII/FPI net ₹−4205.56 cr** — real, current-day data.

**Consequence — UNGATES**:
- **POST-3 (FII/DII cash provisional)** → ACTIVE, not GATED. Just needs a fetch wrapper + freshness/staleness gate.
- **PRE-3 (FII/DII previous session)** → ACTIVE for cash portion. F&O portion still depends on row F (gated).
- **POST-2 (breadth)** → upgrades from PARTIAL to ACTIVE — full-exchange A/D from bhavcopy is feasible without waiting for participant files.

## GATED — CONFIRMED ❌

### 🔴 ROW F · Participant-wise OI file — HTTP 404

- URL: `https://archives.nseindia.com/content/nsccl/fao_participant_oi_16JUL2026.csv`
- Response: **HTTP 404**, HTML error page (3534 bytes)
- Failure classification: URL path may have changed OR file blocked. Do NOT probe alternate paths (per DO-NOT-list). Failure documented as evidence.
- **Impact**: PRE-4 + POST-4 (Participant-wise OI classification) stay **GATED** — the interpretation-per-participant logic (fresh long / fresh short / long unwind / short cover) is the differentiator this table would unlock. Ticket the URL-verification as its own future slice.

### 🔴 ROW H · GIFT Nifty — CONFIRMED ABSENT

- Kite instrument tables in DB: `global_instrument_overrides`, `global_instruments`, `instrument_map` (no `kite_instruments` table as I initially probed — the platform uses `global_instruments` as its instrument master).
- GIFT Nifty is on SGX/NSE-IX, not on the NSE Kite feed. **Confirmed GATED**. PRE-2 stays gated pending external provider proposal.

## STILL TO PROBE — highest-value queue for next execution window

| Row | Question | Method | Slot |
|---|---|---|---|
| A | Index/candle data + EMA/RSI/VWAP/ATR presence | Query `candle` + `global_candles` tables; confirm existing scanner service serves this | Next context window |
| B | Option chain OI/premium/PCR/MaxPain inputs for all 3 indices | Query `option_chain_snapshot` row for latest capture per index | Next context window |
| **C** | **India VIX level via direct Kite quote `NSE:INDIA VIX`** | Live Kite quote via `marketData/router.ts` — sanity 8-35 range; must NOT read from `fno_signal_reasoning.vix` | **Next context window · CRITICAL** |
| D | Instrument-master expiry lookups (weekly/monthly per index) | Query `global_instruments` for NIFTY/BANKNIFTY/SENSEX options grouped by expiry | Next |
| E | ATM straddle premium derivation from B | Compute-on-B result | After B |
| I | Yahoo provider state + US-10Y unit-parsing defect (0.45 vs 4.5%) | Inspect `marketData/` for yahoo client; grep for the 10Y bug | Next |
| J | News source | Confirm no trusted source exists (grep) | Next (fast) |
| **K** | **NIFTY 500 rate-limit sweep feasibility** | Small sample sweep; per ruling — **post-15:30 Friday ONLY** | **Post-close Friday** |
| L | Sector indices Kite coverage | Query `global_instruments` for NSE sector indices | Next |

## Signable-scope preliminary reclassification (subject to remaining probes)

| Section | Spec expectation | Post-Phase-0 verdict |
|---|---|---|
| PRE-1 Overnight global cues | GATED | GATED (row I to confirm) |
| PRE-2 GIFT Nifty | GATED | **CONFIRMED GATED** |
| PRE-3 FII/DII (prev session) | GATED | **ACTIVE for cash · PARTIAL for F&O** ← scope-shift |
| PRE-4 Participant OI | GATED | **CONFIRMED GATED** |
| PRE-5 India VIX | ACTIVE via Kite | pending row C confirm |
| PRE-6 Key Levels | ACTIVE | pending A/B confirm |
| PRE-7 Expected Range | PARTIAL | pending B/C confirm |
| PRE-8 News | GATED (+ MANUAL day one) | GATED + MANUAL primitive (ruled) |
| PRE-9 Expiry check | PARTIAL | pending D confirm |
| PRE-10 Bias & plan | ACTIVE (K-derived) | pending A/B/C confirm |
| POST-1 Index performance | ACTIVE | pending A/L confirm |
| POST-2 Breadth | PARTIAL | **ACTIVE via bhavcopy** ← scope-shift |
| POST-3 FII/DII today | GATED | **ACTIVE** ← scope-shift |
| POST-4 Participant OI EOD | GATED | **CONFIRMED GATED** |
| POST-5 Chain EOD change | ACTIVE | **strongly reinforced — existing ingestor already does most of it** |
| POST-6 Level validation | ACTIVE | pending A confirm |
| POST-7 Sector + stock | PARTIAL | pending L + row K confirm |
| POST-8 News recap | GATED (+ MANUAL) | GATED + MANUAL |
| POST-9 Global live | GATED | GATED |
| POST-10 Tomorrow setup | ACTIVE (K-derived) | pending A/B/C/D confirm |
| POST-11 Journal | ACTIVE + MANUAL | ACTIVE + MANUAL (ruled) |
