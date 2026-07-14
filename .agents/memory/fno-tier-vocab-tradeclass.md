---
name: F&O dual "tier" vocab + tradeClass re-derive
description: The F&O engine has two unrelated "tier" namespaces, and tradeClass is mutable state that must be re-derived after any post-emission tier change.
---

# Two distinct "tier" vocabularies in the F&O engine

Do not conflate them — they live in different modules and mean different things:

- **Signal tier** (`optionSignals.ts`, OptionSignal.tier): `HIGH_CONVICTION | BASELINE`.
  Conviction class of the emitted signal.
- **Sizing tier** (`paperTradingFO.ts`, FNO_BASELINE_RISK): `STANDARD | BASELINE | MICRO`.
  Risk-lane used when opening a paper trade.

They align (STANDARD lane ≈ HIGH_CONVICTION confidence ≥65) but are named separately, so
hygiene helpers come in pairs: `deriveTradeClass(signalTier, hygiene)` vs
`isAutoTradeableSizingTier(sizingTier, hygiene)`.

# tradeClass is mutable derived state — re-derive after every tier mutation

**Rule:** `OptionSignal.tradeClass` is computed in `toSignal()` from the tier at emission,
but `applyOiConfirmation()` can later mutate `s.tier` to `BASELINE` (OI_ATM_CONFLICT).
Any code path that mutates `s.tier` after emission MUST recompute `s.tradeClass` in the
same block, or the response carries a stale `TRADEABLE` on a now-BASELINE signal.

**Why:** a stale `tradeClass=TRADEABLE` on a demoted signal violates the strict INFO_ONLY
contract and could mislead a downstream auto-trade decision / audit surface. Caught in
code review of the 2026-06-09 signal-hygiene fix.

**How to apply:** grep for `s.tier =` / `.tier =` in `optionSignals.ts`; each post-emission
assignment needs a matching `deriveTradeClass(...)` re-derive. `deriveTradeClass` and
`isAutoTradeableSizingTier` are flag-aware (`FNO_SIGNAL_HYGIENE_V2`): both report the
permissive/legacy result when the flag is OFF so rollback restores legacy semantics, not
just execution behavior.
