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

### 2. Real backtest (Kite 15-min CSV export)

```bash
python3 tools/fno-backtester/fno_backtester.py --csv NIFTY.csv --index NIFTY
```

Per-trade detail is written to `backtest_trades_<INDEX>.csv`.

**Expected CSV format** (one file per index, Kite 15-min export):

```
date,open,high,low,close,volume
```

- `date` — IST timestamp parseable by pandas; 15-min bars, 09:15..15:30.
- `--index` — one of `NIFTY`, `BANKNIFTY`, `SENSEX` (drives lot size + exchange txn rate).

### 3. Cost-model worked example

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

## Honesty notes (read before trusting numbers)

- **No look-ahead.** A bar's signal is decided on that bar's CLOSE; fills happen on the
  NEXT bar onward. Indicators use only data up to the decision bar.
- **Premium is approximated** from spot moves via an ATM delta proxy (~0.5) when no real
  historical option chain is supplied. Supply a real chain for production-grade numbers.
- **Open parameters** (HC confidence floor, DD caps, max trades/day, session cutoffs,
  slippage, R:R minimum) are **set by the backtest, not guessed** — see `signal_core_spec.md`
  section 5. Hard-coding them before evidence is exactly what the spec warns against.
