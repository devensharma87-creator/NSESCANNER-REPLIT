---
name: Kite option-chain OI is in CONTRACTS
description: Kite q.oi and NSE openInterest are both in contracts (lots), not underlying shares or quantity. Multiply by lot_size to get underlying quantity. Verified 2026-07-08.
---

## Rule

Kite `q.oi` and NSE `openInterest` are both in **contracts (lots)**.

- 1 contract = 1 lot = `lot_size` underlying shares
- To get underlying exposure: `quantity = q.oi × lot_size`
- To get rupee notional: `notional = ltp × q.oi × lot_size`

**Why:** Both NSE and BSE derivatives publish OI in contracts, and Kite follows the same
convention. The GEX formula and OI heatmap notional formula both correctly multiply by
`lot_size`. The `FNO_LIQUIDITY.MIN_OPTION_OI = 50,000` gate is in contracts.

**How to apply:**
- Never divide raw `q.oi` by `lot_size` before storing — raw contracts go in as-is
- PCR/MaxPain/sentimentScore: use raw OI directly (unit-agnostic ratios)
- GEX / notional: must multiply by `lot_size` (already done in `gex.ts` and `oiLab.ts`)
- `FNO_LIQUIDITY` gate: compare raw `q.oi` directly to 50,000 contracts

**Evidence (2026-07-08 prod DB `option_chain_snapshot`):**
- NIFTY 23450 CE: OI = 7,215 contracts (289 if quantity — impossibly thin for listed option)
- NIFTY 23500 PE: OI = 5,695,820 contracts = 56.9L — consistent with NSE published NIFTY weekly ATM range
- BANKNIFTY 57000 PE: OI = 725,700 contracts — consistent with NSE monthly ATM BANKNIFTY data
- FNO_LIQUIDITY gate correctly passed liquid strikes and rejected thin strikes with contracts interpretation

**Documentation gap (not a math error):**
`gex.ts` header comment originally cited `oiLab.ts line 1716` as proof, but that line
is now baseline OI estimation code — actual notional formula is at line 1746. Fixed
in the 2026-07-08 audit (comment updated; no math change).

**NSE direct comparison:** NSE API is geo-restricted from Replit cloud IPs. Owner
can verify by comparing NSE option chain website OI values vs app OI Lab during market hours.

Full audit: `KITE_OI_UNIT_VERIFICATION_REPORT.md`
