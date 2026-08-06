---
name: Pack 27 live shadow activation closure
description: Live market activation of Upstox shadow + IndianAPI reference providers on 2026-08-06; all 9 gates pass.
---

## Pack 27 — Live Shadow Activation (2026-08-06)

**Why:** Pack 7 built the deterministic infrastructure (parityClassification, providerDiagnostics, 208 tests). Pack 27 activated the live providers against the real market and produced evidence.

### Key instrument key format (Upstox)
- Equities: `NSE_EQ|{ISIN}` e.g. `NSE_EQ|INE002A01018` (RELIANCE)
- NIFTY 50: `NSE_INDEX|Nifty 50` (note: capital N, space)
- BANKNIFTY: `NSE_INDEX|Nifty Bank`
- SENSEX: `BSE_INDEX|SENSEX`
- Response keys use `:` not `|`: `NSE_EQ:RELIANCE`, `NSE_INDEX:Nifty 50`

### classifyParityObservation timestamp unit
- Function expects timestamps in **SECONDS** (not ms)
- Passing `Date.now()` (ms) as nowSec causes FUTURE_TIMESTAMP false positives when upstoxAsOf is set after nowMs
- Correct: `Math.floor(Date.now() / 1000)` for all three params

### getLtp does not route SENSEX/BANKNIFTY
- `getLtp("SENSEX")` and `getLtp("BANKNIFTY")` return null in the router
- For observation scripts: use direct Upstox `market-quote/ltp` endpoint with the correct index key
- Both instruments were verified directly in Gate 3 (live LTPs: SENSEX 78,785, BANKNIFTY 57,945)

### Secret injection requires api-server restart
- Replit secrets added after process start are NOT visible in the running process
- Must restart `artifacts/api-server: API Server` workflow after adding new secrets

### Parity results (23 obs/instrument, 2026-08-06 live market)
| Instrument | Max Δ (bps) | 50bps threshold |
|---|---|---|
| NIFTY 50 | 1.03 | WITHIN |
| RELIANCE | 2.28 | WITHIN |
| HDFCBANK | 3.39 | WITHIN |
| ICICIBANK | 3.43 | WITHIN |
| INFY | 3.42 | WITHIN |
| SBIN | 3.78 | WITHIN |

### Final classifications
- Upstox: ACTIVATED_SHADOW_VERIFIED
- IndianAPI: ACTIVATED_REFERENCE_VERIFIED (PRO plan, pro.indianapi.in)
- Kite: CANONICAL_UNCHANGED

### upstoxHealth().routingState shows NOT_CONFIGURED in fresh tsx process
- This is an in-process singleton that requires background initialization
- The live provider IS working (observation confirmed); routingState just reflects fresh-process state
- Do not treat NOT_CONFIGURED routing state in tsx as a connectivity failure
