---
name: Signal-trust gates must also be applied in reconcile
description: Any new signal-level trust/quality gate on the F&O paper-open path must also be honored by reconcileMissingPaperTrades, or it silently disables mid-day-restart backfill.
---

# Signal-trust gates couple to the reconcile path

When you add a fail-closed gate to `openPaperTrade` that keys off a field on
`OptionSignal` (e.g. `premiumTrusted === true`), remember `reconcileMissingPaperTrades`
also calls `openPaperTrade` — but it builds a **synthetic** `OptionSignal` from
`option_signal_history` rows, which do **not** persist most signal-quality metadata
(no premium source/trust, no enrichment fields).

**Why:** a new `premiumTrusted` backstop rejected *every* reconciled open
(`undefined !== true`), silently disabling backfill of still-live triggers after a
mid-day restart. The bug is invisible in unit tests because reconcile needs a live DB
and a chain fetch.

**How to apply:** when a new gate field is required at open, either (a) re-derive it in
reconcile from a fresh source and stamp it onto the synthetic signal (the chosen fix:
fresh `fetchOptionChain` + `buildOptionChainProvenance` per index, cached, fail-closed
to untrusted on probe error), or (b) persist the field in `option_signal_history` and
read it back. Never assume persisted history carries the new field.

Related: option-premium trust is a per-signal property of the **traded leg**, not just
the chain — demote on missing/zero LTP *or* OI on that specific strike, but do NOT
demote on far-OTM zero-OI strikes elsewhere on an otherwise-trusted Kite chain.
