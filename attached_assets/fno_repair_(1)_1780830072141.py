#!/usr/bin/env python3
"""
Hrishi Associates - Market Scanner by Dev
F&O signal-reasoning data-layer repair & audit tool.

ADDITIVE & NON-DESTRUCTIVE. Reads fno_signal_reasoning.csv, writes corrected
copies to ./repaired_fno/ and prints an audit. Never mutates the source.

Covers the F&O-specific defects:
  F1  Emitted storm:  7,360 rows -> 251 unique signals (mean 29x, max 153x)
  F2  Reject storm:   37,543 rows -> 160 unique events (mean 234x, max 1196x)
  F3  Universal quote corruption: all 44,915 captured_at / signal_date values
      are wrapped in stray embedded double-quotes
  F4  State-machine contradiction: MISSED_WINDOW rows carry TARGET1_HIT/STOPPED
      lifecycle outcomes (a missed signal cannot have a fill result)
  F5  EMITTED + DEMOTED contradiction: 3,537 rows are 'emitted' yet flagged
      DEMOTED (a demoted setup should not also count as emitted)
  F6  Tier band overlap: BASELINE confidence reaches 78 while STANDARD sits at
      72 and HIGH_CONVICTION starts at 69 -> overlapping, incoherent bands
  F7  Kite-session storm: 3,217 reject rows are repeated 'Kite expired /
      Yahoo fallback disabled' polls -> a session-management problem, not a
      market condition

Dedup key = (signal_fingerprint, signal_date) for emitted; for rejects, a
synthetic (signal_date, index_symbol, setup_key, reason_code, raw_reason).
"""
import csv, sys, os, json, argparse
from collections import defaultdict, Counter

csv.field_size_limit(min(sys.maxsize, 2**31 - 1))


def clean(v):
    """F3: strip stray embedded double-quotes universally."""
    return v.replace('"', "").strip() if isinstance(v, str) else v


def num(v):
    try:
        return float(clean(v))
    except (TypeError, ValueError):
        return None


def raw_reason(row):
    snap = clean(row.get("snapshot", ""))
    if not snap:
        return ""
    try:
        return json.loads(snap).get("rawReason", "")
    except Exception:
        return ""


# ---- tier re-classification (F6) -----------------------------------------
# Non-overlapping bands. Adjust thresholds to your engine's intent; the point
# is that the bands MUST NOT overlap.
def classify_tier(confidence):
    if confidence is None:
        return ""
    if confidence >= 70:
        return "HIGH_CONVICTION"
    if confidence >= 60:
        return "STANDARD"
    return "BASELINE"


def dedupe(rows):
    emitted_keep, reject_keep, other_keep = {}, {}, []
    archived = []
    for r in rows:
        dec = clean(r["decision"])
        cap = clean(r["captured_at"])
        if dec == "EMITTED" and clean(r["signal_fingerprint"]):
            # F1: collapse on (fingerprint, signal_date), keep latest capture
            key = (clean(r["signal_fingerprint"]), clean(r["signal_date"])[:10])
            prev = emitted_keep.get(key)
            if prev is None or cap > clean(prev["captured_at"]):
                if prev is not None:
                    archived.append(prev)
                emitted_keep[key] = r
            else:
                archived.append(r)
        elif dec == "PRE_EMISSION_REJECTED":
            # F2: collapse repeated identical rejections
            key = (clean(r["signal_date"])[:10], clean(r["index_symbol"]),
                   clean(r["setup_key"]), clean(r["reason_code"]), raw_reason(r)[:80])
            prev = reject_keep.get(key)
            if prev is None or cap > clean(prev["captured_at"]):
                if prev is not None:
                    archived.append(prev)
                reject_keep[key] = r
            else:
                archived.append(r)
        else:
            other_keep.append(r)
    return list(emitted_keep.values()) + list(reject_keep.values()) + other_keep, archived


def repair_contradictions(rows):
    stats = Counter()
    out = []
    for r in rows:
        dec = clean(r["decision"])
        life = clean(r["lifecycle_status"])
        rc = clean(r["reason_code"])
        conf = num(r["confidence"])

        # F4: a MISSED_WINDOW signal cannot carry a fill outcome
        if dec == "MISSED_WINDOW" and life in ("TARGET1_HIT", "STOPPED"):
            r["lifecycle_status"] = ""
            r["data_quality_flag"] = "CLEARED_INVALID_LIFECYCLE"
            stats["F4_missed_window_lifecycle_cleared"] += 1

        # F5: EMITTED + DEMOTED is contradictory -> reclassify decision
        if dec == "EMITTED" and rc == "DEMOTED":
            r["decision"] = "DEMOTED"   # raw enum; display label handled elsewhere
            r["data_quality_flag"] = (r.get("data_quality_flag", "") +
                                      "|RECLASSIFIED_DEMOTED").strip("|")
            stats["F5_emitted_demoted_reclassified"] += 1

        # F6: recompute tier from confidence into non-overlapping bands
        if conf is not None and clean(r["tier"]):
            correct = classify_tier(conf)
            if correct and correct != clean(r["tier"]):
                r["data_quality_flag"] = (r.get("data_quality_flag", "") +
                                          f"|TIER_WAS_{clean(r['tier'])}").strip("|")
                r["tier"] = correct
                stats["F6_tier_reclassified"] += 1

        out.append(r)
    return out, stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", default="fno_signal_reasoning.csv")
    ap.add_argument("--out", dest="outdir", default="./repaired_fno")
    args = ap.parse_args()

    with open(args.infile, newline="") as f:
        rows = list(csv.DictReader(f))
    fieldnames = list(rows[0].keys()) + ["data_quality_flag"]

    print("=" * 64)
    print(" F&O SIGNAL-REASONING REPAIR — AUDIT SUMMARY")
    print("=" * 64)
    print(f"\nInput rows: {len(rows)}")

    # F3: clean quotes everywhere
    for r in rows:
        for k in r:
            if isinstance(r[k], str):
                r[k] = clean(r[k])
    print("[F3] stripped stray quotes from all string fields")

    # F1/F2: dedupe
    kept, archived = dedupe(rows)
    em = sum(1 for r in kept if r["decision"] == "EMITTED")
    rj = sum(1 for r in kept if r["decision"] == "PRE_EMISSION_REJECTED")
    print(f"[F1] emitted kept: {em}")
    print(f"[F2] rejects kept: {rj}")
    print(f"     archived (duplicate) rows: {len(archived)}")
    print(f"     {len(rows)} -> {len(kept)} rows  ({len(rows)/max(len(kept),1):.1f}x reduction)")

    # F4/F5/F6: contradictions
    kept, stats = repair_contradictions(kept)
    for k, v in stats.items():
        print(f"[{k.split('_')[0]}] {k}: {v}")

    # F7 report (informational — fix is in the engine, not the data)
    # Re-read raw rows for accurate snapshot parsing (quotes already stripped above)
    kite = 0
    for r in rows:
        if r["decision"] == "PRE_EMISSION_REJECTED":
            snap = r.get("snapshot", "")
            if "kite" in snap.lower() or "no_live" in snap.lower():
                kite += 1
    print(f"[F7] Kite-session reject rows in source: {kite} "
          f"(engine-side fix: gate polling on session validity)")

    # F8: emitted rows missing a fingerprint (should never happen)
    no_fp_emitted = sum(1 for r in kept
                        if r["decision"] == "EMITTED" and not r.get("signal_fingerprint"))
    print(f"[F8] emitted rows with NO fingerprint: {no_fp_emitted} "
          f"(engine-side fix: always assign a fingerprint on emit)")

    # write
    os.makedirs(args.outdir, exist_ok=True)
    for r in kept:
        r.setdefault("data_quality_flag", "")
    with open(os.path.join(args.outdir, "fno_signal_reasoning.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(kept)
    if archived:
        for r in archived:
            r.setdefault("data_quality_flag", "ARCHIVED_DUPLICATE")
        with open(os.path.join(args.outdir, "fno_signal_reasoning_archive_pre_dedupe.csv"),
                  "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=fieldnames)
            w.writeheader()
            w.writerows(archived)

    print(f"\nRepaired files written to: {os.path.abspath(args.outdir)}")


if __name__ == "__main__":
    main()
