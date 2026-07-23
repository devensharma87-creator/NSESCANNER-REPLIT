---
name: Kill-switch must live inside the writer function
description: C0 kill-switch placed only in the caller (runEquityPaperTradingTick) left the STAGED lane unblocked. Fix pattern: gate inside the writer before any DB call.
---

## Rule
A kill-switch constant (`EQUITY_AUTO_OPEN_C0_BLOCKED`) that only appears in the
scheduler caller does NOT block alternative call paths. The STAGED approval route
(`openPaperEquityTradeFromStagedOrder → openPaperEquityTrade`) completely bypassed it.

## Fix pattern
The gate must be the **first conditional inside the writer function**, before any
`await` expression (i.e., before the first DB call). In `openPaperEquityTrade`:

```typescript
if ((opts?.source ?? "AUTO") !== "MANUAL" && EQUITY_AUTO_OPEN_C0_BLOCKED) {
  logger.info(...);
  return null;
}
// Only then: await ensurePaperEqProvenanceColumns();
```

**Why:** Any caller that bypasses the outer guard in `runEquityPaperTradingTick`
will still hit the in-function gate. The function is the authoritative enforcement
point, not its callers. MANUAL is exempted by design (owner override).

**How to apply:** When adding a hard-block constant to a writer function, always
place the check inside the writer, not just at the scheduler entry point. Export
the constant so tests can assert its value directly.

## Companion lesson
`FNO_AUTO_OPEN_C0_BLOCKED` was already placed correctly — as the absolute first
statement in `openPaperTrade`. That pattern is correct and should be the model.
