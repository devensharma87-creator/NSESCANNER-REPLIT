#!/usr/bin/env python3
"""
Hrishi Associates - Market Scanner by Dev
Backtest Lab data-layer repair & audit tool.

ADDITIVE & NON-DESTRUCTIVE: reads the exported CSVs, writes corrected copies
to ./repaired/ and prints an audit summary. Never mutates source files.

Covers the 7 confirmed defects:
  1. signal_reasoning re-logged ~29x per signal (dedupe never ran -> archive empty)
  2. duplicate backtest_runs (same trade set persisted under new run_id on re-run)
  3. UTC-vs-IST session-validity false positives
  4. forced square-off not clamped to 15:30 IST (exits at 15:31-15:38)
  5. corrupt post-close entries (16:42, 19:24 IST) -> quarantine
  6. ranking labels a 0-trade strategy "Best Overall" (eligibility gate)
  7. persisted run.summary disagrees with live-recomputed UI summary

Usage:
    python backtest_repair.py --in /path/to/csvs --out ./repaired
"""
import csv, sys, os, json, hashlib, argparse
from datetime import datetime, timedelta
from collections import defaultdict, Counter

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))

IST = timedelta(hours=5, minutes=30)
SESSION_OPEN = 9 * 60 + 15      # 555
SESSION_CLOSE = 15 * 60 + 30    # 930


# ---------------------------------------------------------------- helpers
def parse_ts(ts):
    """Parse a stored UTC timestamp (with optional Z / fractional secs)."""
    if not ts:
        return None
    raw = ts.strip().strip('"').replace("Z", "").split("+")[0].split(".")[0].replace("T", " ").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def to_ist(ts):
    p = parse_ts(ts)
    return (p + IST) if p else None


def minute_of_day(dt):
    return dt.hour * 60 + dt.minute


def load(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def dump(rows, path, fieldnames):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)


# ---------------------------------------------------------------- fix 1
def dedupe_signal_reasoning(rows):
    """Collapse re-logged signals to one row per signal_fingerprint (latest capture).
    Rows without a fingerprint (pre-emission rejects) are kept but de-duplicated
    on (signal_date, index_symbol, setup_key, decision, reason_code)."""
    kept_fp = {}
    no_fp = {}
    archived = []
    for s in rows:
        fp = s.get("signal_fingerprint")
        if fp:
            prev = kept_fp.get(fp)
            if prev is None or s["captured_at"] > prev["captured_at"]:
                if prev is not None:
                    archived.append(prev)
                kept_fp[fp] = s
            else:
                archived.append(s)
        else:
            key = (s["signal_date"], s["index_symbol"], s.get("setup_key", ""),
                   s["decision"], s.get("reason_code", ""))
            prev = no_fp.get(key)
            if prev is None or s["captured_at"] > prev["captured_at"]:
                if prev is not None:
                    archived.append(prev)
                no_fp[key] = s
            else:
                archived.append(s)
    kept = list(kept_fp.values()) + list(no_fp.values())
    return kept, archived


# ---------------------------------------------------------------- fix 2
def dedupe_runs(trades):
    """Find backtest_runs whose trade content is byte-identical and keep the
    earliest run_id (canonical). Returns canonical->[dup...] map."""
    def content_hash(rid):
        rs = [t for t in trades if t["run_id"] == rid]
        body = "\n".join(sorted(
            f"{t['index_symbol']}|{t['setup_key']}|{t['entry_at']}|{t['exit_at']}|{t['pnl']}|{t['strike']}"
            for t in rs))
        return hashlib.md5(body.encode()).hexdigest()

    groups = defaultdict(list)
    for rid in {t["run_id"] for t in trades}:
        groups[content_hash(rid)].append(rid)
    canonical = {}
    for _, rids in groups.items():
        rids_sorted = sorted(rids)
        canon = rids_sorted[0]
        for d in rids_sorted[1:]:
            canonical[d] = canon
    return canonical


# ---------------------------------------------------------------- fix 3/4/5
def repair_trade_timestamps(rows):
    """Re-validate session in IST, clamp late exits to 15:30, quarantine
    post-close entries. Returns (clean_rows, quarantined_rows, stats)."""
    clean, quarantine = [], []
    stats = Counter()
    for t in dict_copy(rows):
        e_ist, x_ist = to_ist(t["entry_at"]), to_ist(t["exit_at"])
        if e_ist is None or x_ist is None:
            stats["unparseable"] += 1
            quarantine.append(t)
            continue
        # Fix 5: entry after close => corrupt capture, quarantine (don't count in P&L)
        if minute_of_day(e_ist) > SESSION_CLOSE or minute_of_day(e_ist) < SESSION_OPEN:
            stats["entry_out_of_session_quarantined"] += 1
            t["data_quality_flag"] = "ENTRY_OUT_OF_SESSION"
            quarantine.append(t)
            continue
        # Fix 4: clamp exit to 15:30 IST square-off
        if minute_of_day(x_ist) > SESSION_CLOSE:
            stats["exit_clamped_to_1530"] += 1
            clamped_ist = x_ist.replace(hour=15, minute=30, second=0)
            t["exit_at"] = (clamped_ist - IST).strftime("%Y-%m-%dT%H:%M:%S") + "Z"
            t["exit_reason"] = (t.get("exit_reason") or "") + "|SQUARE_OFF_1530"
        clean.append(t)
    # Fix 3 is implicit: the validity check now uses IST, so prior "outside session"
    # warnings on UTC times disappear.
    return clean, quarantine, stats


def dict_copy(rows):
    return [dict(r) for r in rows]


# ---------------------------------------------------------------- fix 6
def fix_ranking_eligibility(by_strategy, min_trades=1):
    """A strategy with 0 trades (or < min_trades) is NOT eligible for any
    'Best X' award. Returns sanitized ranking dict."""
    eligible = [s for s in by_strategy if (s.get("totalTrades") or 0) >= min_trades
                and s.get("eligible", True)]

    def best(metric, higher_better=True):
        cand = [s for s in eligible if s.get(metric) is not None]
        if not cand:
            return None
        return (max if higher_better else min)(cand, key=lambda s: s[metric])

    return {
        "OVERALL":       best("compositeScore"),
        "NET_PNL":       best("netPnl"),
        "WIN_RATE":      best("winRate"),
        "PROFIT_FACTOR": best("profitFactor"),
        "DRAWDOWN":      best("maxDrawdown", higher_better=False),
        "AVG_R":         best("avgR"),
    }


# ---------------------------------------------------------------- fix 7
def recompute_summary(trade_rows):
    """Single source of truth for run summary. The UI and the persisted
    summary must both call THIS (no divergent live calc)."""
    decided = [t for t in trade_rows if t.get("pnl") not in (None, "", "null")]
    pnls = [float(t["pnl"]) for t in decided]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    # equity / drawdown
    eq, peak, maxdd = 0.0, 0.0, 0.0
    for p in pnls:
        eq += p
        peak = max(peak, eq)
        maxdd = max(maxdd, peak - eq)
    return {
        "totalSignals": len(trade_rows),
        "decidedTrades": len(decided),
        "wins": len(wins),
        "losses": len(losses),
        "winRate": round(100 * len(wins) / len(decided), 2) if decided else None,
        "totalPnl": round(sum(pnls), 2),
        "grossProfit": round(gross_profit, 2),
        "grossLoss": round(gross_loss, 2),
        "profitFactor": round(gross_profit / gross_loss, 2) if gross_loss else None,
        "expectancy": round(sum(pnls) / len(decided), 2) if decided else None,
        "maxDrawdown": round(maxdd, 2),
    }


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="indir", default=".")
    ap.add_argument("--out", dest="outdir", default="./repaired")
    args = ap.parse_args()

    sig = load(os.path.join(args.indir, "fno_signal_reasoning.csv"))
    trades = load(os.path.join(args.indir, "backtest_trades.csv"))

    print("=" * 60)
    print(" BACKTEST LAB REPAIR — AUDIT SUMMARY")
    print("=" * 60)

    # Fix 1
    kept, archived = dedupe_signal_reasoning(sig)
    print(f"\n[1] signal_reasoning dedupe:")
    print(f"    in={len(sig)}  kept={len(kept)}  archived={len(archived)}")
    dump(kept, os.path.join(args.outdir, "fno_signal_reasoning.csv"), sig[0].keys())
    if archived:
        dump(archived, os.path.join(args.outdir, "fno_signal_reasoning_archive_pre_dedupe.csv"),
             sig[0].keys())

    # Fix 2
    canon = dedupe_runs(trades)
    print(f"\n[2] duplicate runs collapsed: {len(canon)} dup run_ids -> canonical")

    # Fix 3/4/5
    clean, quarantine, stats = repair_trade_timestamps(trades)
    print(f"\n[3/4/5] trade timestamp repair:")
    for k, v in stats.items():
        print(f"    {k}: {v}")
    fieldnames = list(trades[0].keys()) + ["data_quality_flag"]
    dump([{**t, "data_quality_flag": t.get("data_quality_flag", "")} for t in clean],
         os.path.join(args.outdir, "backtest_trades_clean.csv"), fieldnames)
    if quarantine:
        dump([{**t, "data_quality_flag": t.get("data_quality_flag", "")} for t in quarantine],
             os.path.join(args.outdir, "backtest_trades_quarantined.csv"), fieldnames)

    # Fix 7
    real = [t for t in clean if t["run_id"][:8] == "df39d235"]
    print(f"\n[7] canonical recomputed summary (real-replay run df39d235):")
    print("    " + json.dumps(recompute_summary(real)))

    print(f"\nRepaired files written to: {os.path.abspath(args.outdir)}")


if __name__ == "__main__":
    main()
