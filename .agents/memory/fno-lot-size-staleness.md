---
name: F&O static lot-size maps go stale at exchange revisions
description: Paper-trade sizing uses a hardcoded lot map, not the live Kite chain; exchange lot revisions silently corrupt rupee sizing until the maps are re-verified.
---

**Rule**: Any hardcoded F&O lot-size map must be re-verified against the live Kite contract master after every NSE/BSE lot revision (they revise roughly annually). Three maps must stay in sync: `optionChain.ts LOT_SIZES` (feeds `openPaperTrade` sizing via `lotSizeFor` AND backtest runners), `tradeLifecycle/projectTradeEvent.ts FNO_LOT_SIZES` (`parseLots` returns null when qty isn't an integer multiple — honest-null, not wrong values), and scanner `fnoUniverse.ts` (display).

**Why**: The Jan-2026 NSE revision (NIFTY 75→65, FINNIFTY 65→60, MIDCPNIFTY 140→120; SENSEX is 20, BANKEX 30) went unnoticed for ~6 months — every NIFTY paper trade deployed +15.4% rupees, SENSEX half a real contract. Found in the 2026-07-08 quant audit; fixed same day.

**How to apply / verify live**: log in via `curl -c jar -X POST localhost:80/api/auth/login -d '{"password":"$APP_ACCESS_PASSWORD"}'` then `GET /api/options/chain/<UNDERLYING>` — response `lotSize` with `source: kite` is the authoritative contract-master value. The Kite chain path itself is never stale (reads `lot_size` from the instrument dump).

**Key facts**:
- `paper_trade_fo.lot_size` is persisted per row — legacy open positions stay internally consistent after a map fix; NEVER rewrite historical rows (ledger integrity).
- Backtest strategy runner reads LOT_SIZES at run time — re-running an old backtest after a lot fix gives different rupee sizing than the saved run (saved runs untouched).
- Structural fix (owner sign-off pending as of 2026-07-08): prefer `chain.lotSize` from Kite in `openPaperTrade`, static map as fallback + drift alarm on /infra-health.
