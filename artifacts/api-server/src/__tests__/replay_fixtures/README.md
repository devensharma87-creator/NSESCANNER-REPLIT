# Replay fixtures

Recorded Kite session slices used by the deterministic replay harness.

## Provenance rules (hard-enforced)

1. **`provider` MUST be `"kite"`.** Any other value is refused by
   `bucketFetcher.loadFixture()`. No synthetic or reconstructed data.
2. **`sourceHash` MUST equal `sha256(ticks + chain + boards + events)`
   over the raw JSONL bytes**, in that concatenation order. A single
   byte drift → fixture refused. Regenerate the hash with
   `computeFixtureSourceHash()` after any legitimate edit.
3. **Committed baseline slot** — exactly ONE fixture may live directly
   in this repo, and its manifest MUST have `bucketUri: null` and its
   directory name MUST start with `baseline_`. All other fixtures live
   in the object bucket and stream via `bucketFetcher(<id>)`.
4. **Nothing in `golden/` is hand-edited.** Regeneration goes through
   the `replay:record` script (RECORD_GOLDEN=1) with owner PR review —
   see spec §12.3.

## Directory layout for one fixture

```
<fixture-id>/
  manifest.json                    ← includes sourceHash + provider + engineVersion
  ticks.jsonl                      ← Kite websocket capture (monotonic in receivedAtNs)
  option_chain_snapshots.jsonl     ← 1/min chain snapshots (full chain per §7)
  index_boards.jsonl               ← 1/min board snapshots
  system_events.jsonl              ← SystemMode + regime + kite-session edges
  fii_dii.json                     ← EOD flows (may be null on intraday)
  golden/
    paper_trades_fo.jsonl
    paper_trades_eq.jsonl
    signals.jsonl
    telegram_messages.jsonl
    reconciliation_snapshot.json
```

## Recording a new fixture

The **recorder endpoint** (`POST /api/replay/record`, owner-only) will
tap the live Kite stream + option chain snapshotter + system event bus
and write the last N minutes to disk. R1 scaffold does NOT include the
recorder — that's R1-tail — so the first fixture to land here (the
baseline `normal_monday`) has to be captured after the recorder
endpoint is built.

## Status

- **R1 (current)**: no fixtures on disk yet. Bucket fetcher scaffold is
  in place; recorder endpoint pending. Harness self-tests exercise
  refusal paths (bad provider, hash mismatch, missing fixture).
- **R2**: first golden run on `baseline_normal_monday` — recorded on
  the next real market Monday and committed here (~90-min slice).
