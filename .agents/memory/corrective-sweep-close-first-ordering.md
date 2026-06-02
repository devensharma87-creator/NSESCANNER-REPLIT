---
name: Corrective-sweep close-first ordering
description: When a corrective/safety-net sweep both closes a paper trade and advances its lifecycle row, close FIRST then advance — never the reverse.
---

# Corrective-sweep close-first ordering

When a corrective/safety-net sweep (e.g. the orphaned-OPEN F&O paper-exit
re-evaluation) must BOTH close a paper trade AND advance its
`option_signal_history` lifecycle row, do the **close first**, then advance the
lifecycle as best-effort bookkeeping (isolated try/catch).

**Why:** The live cohort path advances-then-closes, but a corrective sweep that
copies that order has a fatal failure window: if the lifecycle CAS commits
(row → terminal) but the close then throws, the next sweep skips the row as
`alreadyTerminal` and the paper trade freezes OPEN — which the 15:20 force-exit
later settles at the **stale `last_premium`**, reintroducing the exact
wrong-settlement bug the sweep exists to fix. Closing first is safe because
`closePaperTradeForSignal` settles at the locked stop/T2 premium, has its own
OPEN-row CAS, and never reads the lifecycle row. A close failure then leaves the
lifecycle non-terminal so the next 30s sweep retries.

**How to apply:** Any new sweep/reconciler that pairs a paper-trade close with a
lifecycle-state advance: close first; gate counters/stats on the close
returning a row (not on the lifecycle CAS); make the lifecycle advance
best-effort and track its failures with a dedicated cosmetic counter (the
residual "closed but lifecycle stale" state is harmless — paper is settled, so
15:20 cannot touch it).
