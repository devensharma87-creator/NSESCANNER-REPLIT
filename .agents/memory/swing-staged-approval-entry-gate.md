---
name: Swing staged approval entry gate requirements
description: Fields required for ENTRY_VALID_NOW vs ENTRY_REVIEW_REQUIRED in the swing approval gate
---

## Rule
`POST /api/swing/staged-orders/:id/approve` returns `ENTRY_REVIEW_REQUIRED` (→ `RECHECK_BLOCKED`) when these fields are missing or invalid:
- `signalAgeDays` (or `validityExpiryMs`) — must be a non-null number
- `triggered` — must be `true`
- Liquidity fields — at least one of `avgTradedValue / volume / spreadPct`

With all fields present and entry price within valid range of LTP: `ENTRY_VALID_NOW` (→ `ENTRY_VALID_NOW`, `approved: true`).

**Why:** Confirmed in production 2026-07-10. HDFCBANK trial: entry=824 without signalAgeDays/triggered → ENTRY_REVIEW_REQUIRED. Same order with signalAgeDays=0, triggered=true, full liquidity → ENTRY_VALID_NOW, approved:true. Paper trade blocked by CONCURRENT_CAP (balance=₹58.59, 10 open positions), not a gate failure.

**How to apply:** When creating staged orders for the swing approval pipeline, always include `signalAgeDays`, `triggered=true`, and liquidity data. CONCURRENT_CAP (zero free cash) is a correct safety gate — check paper portfolio capacity before expecting a SWING_STAGED_APPROVAL paper_trade_eq row.
