# F&O Backtester (standalone, in-repo)

Standalone Python tooling that replays the **Signal Core spec** (`signal_core_spec.md`)
over historical 15-minute index candles, derives Entry/Stop/T1/T2 from structure,
simulates each trade bar-by-bar with **no look-ahead**, applies **real round-trip costs**
(`fno_cost_model.py`), and reports honest metrics (decided win rate, profit factor,
expectancy, max drawdown, and a by-hour breakdown).

> **This is a decision-support tool, not part of the live app.** It does not import,
> read, or write any application code, database, or trading state. No live signal, gate,
> sizing, execution, scheduler, P&L, or env path depends on it. It exists so the parked
> Tier-B trading-logic changes are only adopted once an edge is proven on real data.

## Why it exists

The live system reports **gross** P&L. `fno_cost_model.py` is the single, honest source of
truth for Indian index-option round-trip costs (STT, brokerage, exchange txn, SEBI, stamp,
GST, slippage). A "win" here means **net P&L > 0 after costs** — the same definition the
live settlement path should converge to. Cost rates are **parameters**, verified June 2026
(post Budget-2026 STT hike, effective 1 Apr 2026); update the `RATES` dict from the latest
broker charge-list / NSE-BSE circular before trusting live money.

## Requirements

- Python 3
- `numpy`, `pandas` (already installed in this workspace)

## Usage

### 1. Self-test (synthetic data — engine validation only)

```bash
python3 tools/fno-backtester/fno_backtester.py --selftest
```

Runs the full pipeline end-to-end on synthetic candles to prove the engine executes
without look-ahead. **The numbers are meaningless for strategy** — they only prove the
engine runs.

### 2. Get real data — fetch 2y of Kite 15-min candles (wired path)

The repo-native fetcher reuses the app's **live Kite session** (the encrypted
token already stored in the `kite_session` table — no fresh login, no token in a
chat) and writes the three index CSVs into `tools/fno-backtester/data/`:

```bash
pnpm --filter @workspace/api-server run fetch:index-candles
```

It pulls NIFTY 50 / NIFTY BANK / SENSEX as **SPOT** indices, 15-minute bars,
~2 years, looping in 100-day chunks (under Kite's ~200-day 15-min cap), deduping
chunk-boundary overlaps. Run it **outside market hours** for fully-formed candles.
Requires `DATABASE_URL` + an active Kite session (or `KITE_MIRROR_URL` so a dev
box can mirror the production session).

It is **fail-closed**: if any 100-day chunk errors, that index's CSV is *not*
written (a partial 2-year window would silently bias the backtest) and the run
exits non-zero. Re-running is safe (chunk pulls are idempotent). To deliberately
accept gaps, append `-- --allow-partial`.

> A Python alternative, `kite_fetch_indices.py`, is kept for reference — but it
> needs the token as `KITE_API_KEY` / `KITE_ACCESS_TOKEN` env vars, which is
> **not** how this app stores it. Prefer the TS fetcher above.

### Spot vs futures — settled (and why it's a correctness call)

The advisor raised "spot candles report volume=0 vs near-month futures with real
volume" and leaned toward futures. The codebase settles it the other way:

- The **live** engine computes index VWAP from Kite **SPOT** candles where
  cash-index volume is 0 (`kiteIntraday.ts`: *"Cash-index volume from Kite is
  0… emit zero"*).
- Live `sessionVwap` (`indicators.ts`) **falls back to typical price** when
  cumulative volume is 0 — it never goes undefined.
- The volume-breakout / volume-profile detectors stay **dormant** for indices
  (they gate on volume that is always 0).

The rule is: *the backtest must use the same volume basis as live, or the
comparison is invalid.* Fetching futures would test a strategy the live system
does **not** run. So we fetch **spot**, and the backtester's `session_vwap`
mirrors the same typical-price fallback (see the docstring there) so zero-volume
spot data yields a valid, live-matching VWAP gate instead of killing every
signal with NaN.

### 3. Run the backtest

```bash
python3 tools/fno-backtester/fno_backtester.py --csv tools/fno-backtester/data/NIFTY.csv --index NIFTY
```

Per-trade detail is written to `backtest_trades_<INDEX>.csv`.

**Expected CSV format** (one file per index, produced by the fetchers above):

```
date,open,high,low,close,volume
```

- `date` — IST timestamp parseable by pandas; 15-min bars, 09:15..15:30.
- `--index` — one of `NIFTY`, `BANKNIFTY`, `SENSEX` (drives lot size + exchange txn rate).

### 4. Cost-model worked example

```bash
python3 tools/fno-backtester/fno_cost_model.py
```

Prints gross/costs/net and the break-even premium move for sample NIFTY / BANKNIFTY /
SENSEX round trips.

## Files

| File | Purpose |
|---|---|
| `fno_cost_model.py` | Honest round-trip cost model. `net_pnl()` is the shared win-definition. |
| `fno_backtester.py` | Candle replay + confluence-gate signal core + trade sim + reporting. |
| `signal_core_spec.md` | The Signal Core v1 design spec the backtester implements (reference). |
| `signal_logging_fix_spec.md` | The once-per-transition logging spec (reference; drove Tier-A1). |
| `kite_fetch_indices.py` | Reference Python fetcher (env-var token). Prefer the wired TS fetcher below. |
| `data/` | Output of the fetchers — `NIFTY.csv` / `BANKNIFTY.csv` / `SENSEX.csv` (gitignored; regenerate). |

The **wired** fetcher is `pnpm --filter @workspace/api-server run fetch:index-candles`
(`artifacts/api-server/src/scripts/fetchKiteIndexCandles.ts`) — it reuses the live
Kite session from the DB. See "Get real data" above.

## Honesty notes (read before trusting numbers)

- **No look-ahead.** A bar's signal is decided on that bar's CLOSE; fills happen on the
  NEXT bar onward. Indicators use only data up to the decision bar.
- **Premium is approximated** from spot moves via an ATM delta proxy (~0.5) when no real
  historical option chain is supplied. Supply a real chain for production-grade numbers.
- **Open parameters** (HC confidence floor, DD caps, max trades/day, session cutoffs,
  slippage, R:R minimum) are **set by the backtest, not guessed** — see `signal_core_spec.md`
  section 5. Hard-coding them before evidence is exactly what the spec warns against.
