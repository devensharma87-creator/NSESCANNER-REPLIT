---
name: F&O quote age=0 proxy prohibition (P0.2 C2)
description: quoteAgeSec=0 is now explicitly rejected for F&O lanes in Phase B; tests that used it must use a positive value; negative quoteAgeSec is also rejected for all lanes.
---

## Rule

For F&O lanes (`nse_fo`/`bse_fo`), Phase B step 2 in `sessionAdmission.ts` rejects
`ctx.quoteAgeSec === 0` with `TRADE_ADMISSION_CONTEXT_INCOMPLETE`. The Kite REST
option-chain response (`KiteQuote`) has NO per-contract or response-level exchange/
provider event timestamp. `quoteAgeSec=0` was used as a "just fetched" proxy —
that proxy is now explicitly prohibited.

Pass `quoteAgeSec: NaN` when no provider event timestamp is available (fail closed).

Additionally, `quoteAgeSec < 0` (future timestamp) is rejected for **all** lanes
with `TRADE_ADMISSION_CONTEXT_INCOMPLETE` — no clock-skew tolerance.

**Why:** `quoteAgeSec=0` silently assumes the quote is "fresh" without any actual
provider event timestamp backing it. The Kite chain fetch time is not an exchange
timestamp. The P0.2 correction makes the gap explicit — F&O opens fail closed until
a provider with adequate per-contract event timestamps is integrated.

**How to apply:**
- Any new F&O Phase B test must use `quoteAgeSec > 0` (e.g., 5) to reach the
  calendar/session/cutoff checks, or `quoteAgeSec: NaN` to test the fail-closed path.
- If you add a test meant to reach `CALENDAR_UNAVAILABLE` or `ENTRY_CUTOFF_PASSED`
  for F&O lanes, use a small positive age (e.g., 5s) — `quoteAgeSec: 0` will be
  intercepted before those checks run.
- For equity lanes, negative quoteAgeSec = future timestamp → structured rejection;
  the caller must compute `decisionTime - quoteTs` before calling admission.
