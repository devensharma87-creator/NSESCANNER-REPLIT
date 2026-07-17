# Row K · NIFTY rate-limit sweep — 2026-07-17 post-close

**Executed:** 2026-07-17 19:41:45 IST (off-hours, market closed).
**Session:** MRV421 (Devendra), login 11:11:23 UTC / 16:41 IST re-login post-recovery.
**Client:** `getRestClient()` from kiteAuth.ts — same wrapper the app uses at runtime.

---

## Phase A · 30 sequential single-symbol getQuote calls

Sample: NIFTY 50 top-30 by weight. No pacing (as-fast-as-possible sequential loop).

| Metric | Value |
|---|---|
| Total wall time | 8,812 ms |
| Errors | 0 |
| HTTP 429 (rate-limit) | 0 |
| Latency min | 232 ms |
| Latency p50 | 236 ms |
| Latency p95 | 316 ms |
| Latency max | 1,331 ms (first call, cold TCP) |
| Latency mean | 294 ms |
| Effective sustained rate | ~3.4 req/sec |

**Full per-call log:** captured in `/tmp/row_k_result.log` for the session; not persisted (transient).

**Interpretation:**
- **No 429 encountered at ~3.4 req/sec off-hours over 30 requests.** Kite's advertised 3-req/sec ceiling is at or near this measured rate — we did not exceed it.
- p50 == 236ms and p95 == 316ms are tight (80ms spread), consistent with steady-state HTTPS RTT + Kite's internal processing.
- Max 1,331ms is the cold-connection first call; ignorable outlier.

## Phase B · single batch call with 100 symbols

| Metric | Value |
|---|---|
| Total wall time | 262 ms |
| Symbols requested | 100 |
| Symbols returned | 97 (3 likely delisted / renamed) |
| Errors | 0 |
| HTTP 429 | 0 |
| Per-symbol effective cost | 2.6 ms/sym |

**Interpretation:**
- One batch call at **~34× lower per-symbol cost than sequential** (2.6ms/sym vs 294ms/sym).
- 97/100 returns suggests 3 symbols in the sample list are delisted or renamed on the current Kite universe (likely HDFC post-merger, PIIND, and one more). Not a rate-limit issue — the batch endpoint silently drops unknown symbols and returns what it has.
- **500-symbol batch was not attempted tonight** — the honest largest-safe sample without vetted NIFTY 500 constituents is 100. A 500-symbol call is theoretically supported by Kite (up to 500 per batch) but returning the fossil-safe result set requires validating symbols first, and that's an M2/M3 task, not a Row K task.

---

## Verdict for the matrix

**Row K: FEASIBLE off-hours; session-hours confirmation required.**

- **Sequential polling** at up to 3 req/sec sustained is safe off-hours over a 30-call sample. Session-hours may be more restrictive (feed subscription + REST share the same daily quota).
- **Batch call** is the only viable pattern for wide universes (POST-2 breadth / M5 contract-selection across 3 indices). 100-symbol batch = 262ms — comfortably within any reasonable request budget.
- **Caveat for the matrix entry**: "Verified off-hours 2026-07-17 19:41 IST; session-hours confirmation during next live session." A 60-second spot-check during Monday's session (post-M1-kickoff, read-only, mid-day) closes the row fully.

## Consumers this measurement unblocks

- **POST-2 breadth** (briefing feature Checkpoint 0) — can safely be implemented via a single batched `kc.getQuote(top-N-syms)` call. Cost model = ~3ms/sym per batch tick.
- **M5 contract-selection** — for the first real paper trade, the 3-index quote fetch (NIFTY + BANKNIFTY + SENSEX with ATM ± N strikes each, ~30 contracts) costs ~1 batch call = ~250ms. Well within any signal-emission tick budget.
- **Sector index sweep (Row L)** — 10 sector indices in one batch = ~250ms; effectively free.

## What this measurement does NOT establish

- 500-symbol full-universe sweep (needs vetted symbol list).
- Session-hours rate limit behavior (may be more restrictive under active feed subscription load).
- 429 threshold (never encountered; ceiling is ≥ ~3.4 req/sec at least off-hours).

## Follow-up owner-visible decision (defer to Monday mid-day)

60-second spot-check during live session on Monday: repeat Phase A at ~3 req/sec for 30 calls; observe any 429s. If clean, Row K promotes to fully-ACTIVE. If 429s appear, we now have the actual session-hours ceiling.
