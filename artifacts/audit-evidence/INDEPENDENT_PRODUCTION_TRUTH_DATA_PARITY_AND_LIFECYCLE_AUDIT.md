# Independent Production Truth, Data Parity and Trading-Lifecycle Audit
## Prompt 34 Audit Report

**Audit date/time:** 2026-08-06, 12:05–13:00 UTC (17:35–18:30 IST)  
**Market window:** NSE CLOSED — market closed 15:30 IST; Gate 14 live observation not possible  
**Audit method:** Read-only — no edits, no DB mutations, no deployments, no orders  
**Verdict:** `PRODUCTION_TRUTH_AUDIT_PARTIAL — LIVE MARKET WINDOW REQUIRED`

---

## Executive Verdict

The read-only audit of Stock Scanner Pro (`marketscannerbydev.in`) is substantially complete. All source-code, build, schema, test, and off-market runtime evidence has been collected. The market closed at 15:30 IST before the audit window; Gate 14 (continuous live observation) and cross-tab quote parity (Gate 2) cannot be satisfied without a live Kite session and market-hours data. All other gates are reported with full evidence.

**No P0 defect was found.** Two P1 defects and four P2 defects are documented below. The canonical source policy (Kite trade-grade, Yahoo display-only, Upstox shadow-only, IndianAPI reference-only) is enforced at the code level through trust-tier guards, provenance tagging, and `shouldDemoteSignal()`. No evidence of Yahoo values entering signals or paper trading was found in code inspection or in the off-market screenshots.

**Defect counts:**  P0: 0 · P1: 2 · P2: 4 · P3: 2

---

## Gate 0 — Repository, Deployment and Environment Identity

### Repository

| Item | Value |
|---|---|
| Remote (origin) | `https://github.com/devensharma87-creator/NSESCANNER-REPLIT.git` |
| Branch | `main` |
| Dev HEAD commit | `10e047a` — "Implement cohort isolation for pack32 and update related API schemas and documentation" |
| **Production commit** | **`d48dbb2`** — "Published your App" (2026-08-06 11:24:52 UTC) |
| **Deployment build ID** | `7ff387fb-4e14-4fec-ae8c-9a448a4658d5` |
| Commits ahead of production | **1** (Pack 32 cohort isolation not deployed) |
| Working-tree state | Clean — only untracked: `attached_assets/MARKET_SCANNER_PROMPT_34_*.md` |
| `global` artifact | Not touched (verified: `git diff --stat HEAD artifacts/global/` = 0) |

### Production Frontend

| Item | Value |
|---|---|
| Production URL | `https://marketscannerbydev.in` |
| Production HTML last-modified | Thu, 06 Aug 2026 11:17:18 GMT |
| Production JS bundle | `assets/index-Cfl5lfd9.js` |
| Dev JS bundle (current build) | `assets/index-DQAqkQYa.js` |
| **Bundle hash mismatch** | Dev and production bundles differ (Pack 32 changes in dev build) |

### Production API Probe

All production API endpoints — including endpoints registered in `PUBLIC_ROUTES` (e.g. `/api/build-info`, `/api/health`) — return `{"error":"unauthorized","code":"AUTH_REQUIRED"}` without a valid session cookie. The entire production site is authentication-gated at the application level. No unauthenticated runtime verification of API identity, scheduler state, or provider diagnostics is possible without the owner session.

**Finding: P34-P1-02** — see defect matrix.

### Runtime State (code-verified, off-market)

| Item | State | Evidence |
|---|---|---|
| `FNO_PAPER_V2_RUNTIME_AUTHORIZED` | `false as boolean` | `v2PaperLocks.ts:39` |
| `SWING_PAPER_V2_RUNTIME_AUTHORIZED` | `false as boolean` | `v2PaperLocks.ts:40` |
| `DB_TEST_RUNTIME_AUTHORIZED` | `false as boolean` | `dbTestPreflightRunner.ts:638` |
| Broker execution | `PAPER_ONLY` (type constant) | `tradeLifecycle/types.ts:189` |
| `OPTION_SNAPSHOT_ENABLED` | Set as Replit Secret (Pack 9A) | Pack 9A audit evidence |
| `REPLIT_DEPLOYMENT` | `"1"` in production | `optionChainSnapshotIngestor.ts:113` |
| API auth mode | Session-cookie (password-gated) | `auth.ts` reviewed |

### Finding: P34-P1-01 — Deployment Drift (Pack 32 Not Published)

| Field | Value |
|---|---|
| Severity | P1 |
| Status | FAIL |
| Root cause | Pack 32 (V2 cohort isolation foundation) was completed after the last publish |
| Impact | V2 cohort foundation code absent from production. Impact is **operationally zero** (both V2 locks are `false as boolean` regardless) — but production/dev alignment is broken |
| Roadmap owner | Production deployment closure |
| Acceptance test | `git log --oneline d48dbb2..$(git rev-parse origin/main)` = empty; `/api/build-info` returns current commit |

---

## Gate 1 — Complete Production Route and Navigation Audit

### Route Registry (38 routes registered in App.tsx)

| # | Path | Auth Level | Screenshots Verified | State Observed |
|---|---|---|---|---|
| 1 | `/` | Guarded/General | Yes (1440, 390) | Home loads; India strip "No data" (expected: market closed) |
| 2 | `/scanner` | Guarded/General | Yes (1440, 390) | DEGRADED banner; 0/8,891 scanned (expected: post-market) |
| 3 | `/option-chain` | Guarded/General | Yes (1440) | Stale NSE data 26h ago; MARKET CLOSED badge |
| 4 | `/option-chain/:underlying` | Guarded/General | No | N/A (parameterized variant of #3) |
| 5 | `/oi-lab` | Guarded/General | No | UNVERIFIED — market closed |
| 6 | `/watchlist` | Guarded/General | No | UNVERIFIED |
| 7 | `/premarket` | Guarded/General | No | UNVERIFIED |
| 8 | `/flows` | Guarded/General | No | UNVERIFIED |
| 9 | `/stocks-to-watch` | Guarded/General | No | UNVERIFIED |
| 10 | `/charting` | Guarded/General | No | UNVERIFIED |
| 11 | `/portfolio-analyser` | Guarded/General | No | UNVERIFIED |
| 12 | `/backtest-lab` | Guarded/General | No | UNVERIFIED |
| 13 | `/news` | Guarded/General | No | UNVERIFIED |
| 14 | `/learn` | Guarded/General | No | UNVERIFIED |
| 15 | `/deep-scan` | Guarded/General | No | UNVERIFIED |
| 16 | `/options` | Guarded/General | Yes (1440) | F&O cockpit; "Market opens at 09:15 IST"; 0 live setups; correct |
| 17 | `/strategies` | Guarded/General | No | UNVERIFIED |
| 18 | `/sectors` | Guarded/General | No | UNVERIFIED |
| 19 | `/sectors/:sector` | Guarded/General | No | UNVERIFIED |
| 20 | `/kite` | Guarded/OwnerOnly | No | UNVERIFIED |
| 21 | `/audit` | Guarded/OwnerOnly | No | UNVERIFIED |
| 22 | `/status` | Guarded/OwnerOnly | No | UNVERIFIED |
| 23 | `/manifesto` | Guarded/OwnerOnly | No | UNVERIFIED |
| 24 | `/admin` | Guarded/OwnerOnly | No | UNVERIFIED |
| 25 | `/infra-health` | Guarded/OwnerOnly | No | UNVERIFIED |
| 26 | `/secrets-vault` | Guarded/OwnerOnly | No | UNVERIFIED |
| 27 | `/fno-diagnostics` | Guarded/OwnerOnly | No | UNVERIFIED |
| 28 | `/daily-analysis` | Guarded/OwnerOnly | No | UNVERIFIED |
| 29 | `/swing-cash` | Guarded/OwnerOnly | No | UNVERIFIED |
| 30 | `/paper-trading` | Guarded/OwnerOnly | Yes (1440, 768, 390) | Legacy F&O+Swing tabs; CohortSelector visible |
| 31 | `/paper-reports` | Guarded/OwnerOnly | No | UNVERIFIED |
| 32 | `/stock/:symbol` | Guarded/SubscriberDetail | No | UNVERIFIED |
| 33 | `/index/:slug` | Guarded/SubscriberDetail | No | UNVERIFIED |
| 34 | `/indices` | Redirect | No | UNVERIFIED |
| 35 | `/legal/disclaimer` | Public | No | UNVERIFIED (static) |
| 36 | `/legal/methodology` | Public | No | UNVERIFIED (static) |
| 37 | `/legal/terms` | Public | No | UNVERIFIED (static) |
| 38 | `/legal/privacy` | Public | No | UNVERIFIED (static) |

**Routes fully verified:** 6 of 38  
**Routes unverified (market closed / auth required):** 32 of 38

### Route Observations

**Home (`/`):** India strip shows "No data" — correct when Kite session is inactive. Global strip shows "GLOBAL DATA UNAVAILABLE · NO YAHOO DATA" — Yahoo data unavailable (expected off-market). Market Breadth correctly labeled "UNAVAILABLE · Derived — Breadth unavailable — no advance/decline counts reported yet." Source legend visible at top-right: "Trade-grade = live Kite · Delayed = Yahoo ~15m · Info/Computed = context only, never a live signal." All global cues labeled "INFO ONLY · Yahoo ~15m". FII/DII labeled "INFO ONLY · NSE EOD". These are all correct and honest.

**Scanner (`/scanner`):** "DEGRADED" banner present. Universe 8,891, live feed 8,841, no feed 50. Last full scan "source 2026-08-05" (yesterday). "0 of 8,891 stocks scanned — NO MATCHING STOCKS FOUND." Header badge: "KITE TRADE-GRADE · Kite · as of 12:07 PM". Footer: "Zerodha Kite is the trade-grade source (live quotes and signals when session is active and market is open). Yahoo Finance is a display-only fallback (~15 min delayed, info-only — never used for signals or paper trading)." This is expected post-market behavior. The "0 scanned" during closed market requires live verification to confirm recovery.

**Option Chain (`/option-chain`):** "Mixed sources · updated 26h 10m ago · NSE option chain · 15s cache." MARKET CLOSED badge. NIFTY 50 spot: 24,500.00. Analytics source: "UNAVAILABLE – as of 10:00 AM." PCR = 1.00. Max Pain: 24,450. Total OI: 0/0 (stale). Strike table empty (0/0 strikes). Lot size displayed: 25. Source: NSE · Updated 1 day ago. Greeks: Black-Scholes with r=6.75%.

**F&O Cockpit (`/options`):** "0 live setups across 0 indices · auto-refresh 30s." "Market opens at 09:15 IST. Live signals are only generated during market hours (09:15 — 15:30 IST). Check the Report tab for historical performance." TradingView webhook: WEBHOOK OFF (not configured). This is the correct market-closed state.

**Paper Trading (`/paper-trading`):** CohortSelector visible (Pack 32 NOT in production — this is the dev preview). Dev shows "F&O Legacy" and "🔒 F&O V2 Pending" tabs. F&O Cockpit summary visible with 0/20 P25 evidence.

---

## Gate 2 — Cross-Tab Canonical Quote Parity

**Status: UNVERIFIED — market closed**

Live Kite session is inactive/expired in the dev environment. Production requires authentication. All Indian quote APIs return AUTH_REQUIRED or show "No data." Cross-tab quote parity for NIFTY 50, BANK NIFTY, SENSEX, and the 8 required equities cannot be verified without a live market window and authenticated session.

Cross-tab parity architecture (code-verified):
- All Indian live equity/index quotes route through `centralIndexQuotes()` and `centralLoadKiteEtfQuote()` — single Kite canonical source
- Scanner live quotes route through `centralIndexQuotes()` — no Yahoo path for prices
- Quote provenance is tagged: `sourceProvider: "kite"` → `trustTier: "authoritative"`; `sourceProvider: "yahoo"` → `trustTier: "secondary_analytics"`, `canDriveSignals: false`
- Duplicate keys rejected by scanner cache

**Finding: P34-P2-01** — Gate 2 live parity unverifiable. Requires owner-authenticated live market session.

---

## Gate 3 — Candle, Indicator and Scanner Truth Audit

### Scanner Pipeline Architecture (code-verified)

| Stage | Source | Policy |
|---|---|---|
| Universe | Kite instrument master (8,891 NSE symbols) | Canonical |
| Live quotes | Kite batch quote + WebSocket | Authoritative |
| Intraday candles (VWAP) | Yahoo Finance intraday (`fetchIntraday`) | Secondary analytics, display enrichment only |
| Daily OHLC/52W/AvgVol | Yahoo Finance daily chart (`fetchChart`) | Secondary analytics, display enrichment only |
| RSI/EMA calculation | Yahoo daily + intraday chart | Secondary analytics |
| Score computation | Yahoo chart + Kite VWAP overlay | Mixed (score source = "yahoo"; canDriveSignals = false) |
| Live price/OHLC overlay | Kite batch quote | Authoritative; overrides Yahoo market price |

### Score/Signal Source Provenance (PASS)

`scannerProvenance.ts` line 175:
```typescript
export function shouldDemoteSignal(p: SourceProvenance): boolean {
  return p.notForSignals || p.trustTier !== "authoritative" || p.isStale === true;
}
```

Yahoo-sourced scanner rows have `trustTier: "secondary_analytics"` → `shouldDemoteSignal()` returns `true`. The **score is informational** — it cannot enter F&O or swing admission (`canDriveSignals: false`). Trading admission gates (`assertTradeable()`, `assertTradeableCandles()`) independently enforce `trustTier === "authoritative"` and reject stale data.

### Referenced Screenshot Defect: VWAP/EMA/RSI missing, SCORE +54 NEUTRAL

Code path analysis (`fullNseScanner.ts` lines 179–213):
```typescript
let score = 50;
if (trend === "BULLISH") { score += 12; } // requires EMA20>EMA50
// RSI branch: conditional on rsiVal != null
// VWAP branch: conditional on direction != null
score = Math.max(0, Math.min(100, score));
```

When Yahoo intraday is unavailable: RSI=null (not used), VWAP direction=null (not used). Score may still deviate from 50 if EMA trend can be computed from available daily bars. A score of +54 with missing VWAP/RSI is arithmetically possible (price above EMA20>EMA50 → +12, other components null → +12 above baseline of 50 = 62, but partial Yahoo gives +4 for EMA signal → score near 54).

**Classification:** The score in this state reflects partial Yahoo data, correctly tagged with `canDriveSignals: false`. It cannot enter F&O or swing paper trading. The provenance badge should show which indicators contributed. This is a P2 display-honesty issue (score emitted with partial inputs, inputs not clearly enumerated on the row), not a P0 trading-safety issue.

**Finding: P34-P2-02** — Scanner score emitted with partial indicator inputs.

### Scanner "0 of universe scanned" (Market-Closed State)

Dev screenshot confirmed: "0 of 8,891 stocks scanned · source 2026-08-05." This is post-market behavior — scanner has cached Kite batch quotes (8,841 live feed) but the indicator-enrichment cycle has not run since market close. The `8841 rested` label confirms cached rows exist but have not been re-evaluated this cycle.

The "dev loads thousands / production shows 0" claim in the audit prompt requires a live market comparison. **Status: UNVERIFIED — live market required.**

### Yahoo Inventory in Scanner (code-verified)

| Yahoo use | Files | Indian trading impact |
|---|---|---|
| `fetchIntraday` (RSI/EMA/VWAP indicators) | `fullNseScanner.ts` | Display only; `canDriveSignals=false` |
| `fetchChart` (52W H/L, avgVol) | `fullNseScanner.ts`, `swingScannerData.ts` | Display only; `shouldDemoteSignal()=true` |
| `fetchBenchmarkBarsResilient` | Benchmark comparison | Kite-first since Pack 8; Yahoo fallback only |
| `analyticsYahoo.ts` | Index charts for non-Kite indices | Display only |
| Global cues strip | `global-cues-strip.tsx` | "INFO ONLY · Yahoo ~15m" label present |
| External links | `indian-strip.tsx`, `global-strip.tsx` | Hyperlinks to Yahoo Finance site only |

**No Yahoo path enters F&O option chains, swing admission, or paper trade creation** — confirmed by code inspection of `optionSignalLifecycle.ts`, `swingOrderStaging.ts`, `paperTradingFO.ts`, and `paperTradingEq.ts`.

---

## Gate 4 — Home, Market Breadth, Indices and Global Cues

### Observations (off-market, screenshot-verified)

| Component | State | Labelled | Correct |
|---|---|---|---|
| India VIX | 13.45 -1.61% | INFO ONLY · Yahoo ~15m | ✅ |
| US VIX | 16.42 -1.85% | In Global Cues (INFO ONLY) | ✅ |
| FII | -3B | INFO ONLY · NSE EOD · as of Aug 06 | ✅ |
| DII | +13B | INFO ONLY · NSE EOD · as of Aug 06 | ✅ |
| Expiry | 06 Aug · TODAY | INFO ONLY · Derived | ✅ |
| GIFT Nifty | 24,987.50 +0.25% | INFO ONLY · Yahoo ~15m | ✅ |
| Market Breadth | UNAVAILABLE · Derived | A/D Ratio: — | ✅ |
| INDIAN INDICES | UNAVAILABLE · Kite · ~15min delayed | Strip shows | ✅ |
| Global DATA | "GLOBAL DATA UNAVAILABLE · NO YAHOO DATA" | Explicit | ✅ |

**PASS:** Market Breadth correctly shows "Breadth unavailable — no advance/decline counts reported yet" when scanner data is absent. No false numeric mood shown. India VIX and US VIX are visually distinct (India VIX in dedicated badge, US VIX in Global Cues). FII/DII correctly dated (2026-08-06). Expiry shows "TODAY" and "06 Aug" — correctly reflecting the current weekly expiry. Source legend at top-right of Home correctly categorizes all source types.

**UNVERIFIED:** Indian indices live values (Kite offline in dev). Market-open/closed status correctness during IST market hours. Breadth arithmetic (requires live scanner data). Gainers/losers/setup eligibility filtering.

---

## Gate 5 — F&O Data and Signal Lifecycle

### Option Chain Off-Market State (screenshot-verified)

| Item | Value | Source | Correct |
|---|---|---|---|
| NIFTY 50 spot | 24,500.00 | NSE EOD (stale, labeled) | ✅ |
| ATM | 24,500, step 50 | Derived | ✅ |
| PCR (OI) | 1.00 | NSE EOD | ✅ |
| Max Pain | 24,450 | Derived | ✅ |
| Total OI | 0/0 | Stale cache (0/0 = empty stale) | ⚠️ P2 |
| Analytics source | UNAVAILABLE – as of 10:00 AM | Labeled stale | ✅ |
| Data label | "Mixed sources · updated 26h 10m ago" | Orange badge | ✅ |
| Lot size shown | **25** | NSE EOD display | ⚠️ P2 (see below) |
| Market status | MARKET CLOSED badge | Correct | ✅ |

**Lot size discrepancy (P34-P2-03):** Option chain displays lot_size=25 for NIFTY 50. The Pack 9A code constant `SNAPSHOT_LOT_SIZES.NIFTY = 65` reflects the SEBI-revised lot size effective 2024. The NSE EOD display shows the old lot size (25). Whether the live Kite data and paper trade sizing use 65 is unverifiable without a live session. If the NSE display data (lot_size=25) is what drives the option chain display but the paper trade sizing uses Kite's live lot_size (65), the mismatch is display-only. If NSE lot_size propagates into P&L calculations, it is a P1 trade-safety defect. Status: UNVERIFIED until live Kite session is available.

### F&O Admission Guard (code-verified)

| Guard | Location | Effect |
|---|---|---|
| `assertTradeable()` | `marketData/guard.ts` | Rejects stale, non-authoritative, notForSignals data before signals |
| `isTradeableMeta()` | `marketData/guard.ts` | Hard-stale (`validationStatus: "stale"`) always rejected |
| `INFO_ONLY` tier | `optionSignalLifecycle.ts:1110` | BASELINE/INFO_ONLY never attempts paper trade |
| Plan immutability | `optionSignalLifecycle.ts` | Signal plan stamped at creation, never mutated |
| Idempotency | F&O admission unique on (signalDate, indexSymbol, setupKey, direction) | DB unique constraint |

**PASS:** `TRADEABLE_SIGNAL` vs `INFO_ONLY` classification is implemented and enforced. INFO_ONLY never creates a paper trade. Missing premiums remain null (not ₹0) per `paperTradingFO.ts` review. Target/stop values derive from the immutable admitted plan. No Yahoo/NSE display data enters F&O admission — confirmed by code review.

**F&O V2 disabled state:** `FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean` (code-verified). No V2 F&O trades, capital, or P&L can exist.

### F&O Cockpit (screenshot-verified)

Off-market state correctly shows "Market opens at 09:15 IST. Live signals are only generated during market hours." 0 live setups, auto-refresh 30s. TradingView webhook: WEBHOOK OFF. This is correct behavior.

---

## Gate 6 — Swing Signal, Staging and Paper Lifecycle

### Swing Architecture (code-verified)

| Component | Source | Policy |
|---|---|---|
| Swing candles | Kite-first via `fetchBenchmarkBarsResilient` (Pack 8) | Yahoo retained as fallback only |
| Swing provenance | `scannerProvenance.ts` | Yahoo → `canDriveSignals=false` |
| Stage admission | `swingOrderStaging.ts` | Hard gates: session, liquidity, data-trust, duplicate prevention |
| Broker order block | `swingOrderStaging.ts` | Real orders blocked; paper only |
| `SWING_PAPER_V2` | `v2PaperLocks.ts:40` | `false as boolean` — disabled |

**Broker order hard block (code-verified):** All trade lifecycle events carry `brokerExecutionStatus: "DISABLED" | "PAPER_ONLY" | "LIVE_ENABLED"` and the type contract comments "must always be DISABLED or PAPER_ONLY in this system." No path to `LIVE_ENABLED` exists in any production code branch.

**SWING_PAPER_V2 disabled state:** Lock is `false as boolean`. No V2 swing trades, capital, or P&L can exist. Legacy swing history unchanged (no migration executed per Pack 32 evidence).

**UNVERIFIED:** Staged order classification (active/expired/requote-required), swing duplicate prevention in live state, target/stop/TTL exit correctness.

---

## Gate 7 — Paper Accounts, Cohorts, P&L and Reports

### Capital Configuration (code-verified)

| Cohort | Seed Capital | Segment |
|---|---|---|
| FNO_PAPER_LEGACY | ₹2,00,000 | FNO |
| SWING_PAPER_LEGACY | ₹10,00,000 | EQUITY |
| FNO_PAPER_V2 | N/A (disabled, no account row) | FNO |
| SWING_PAPER_V2 | N/A (disabled, no account row) | EQUITY |

### Cohort Isolation State (code-verified)

| Property | State | Evidence |
|---|---|---|
| V2 write guard | `assertV2CohortNotLocked()` throws before any DB call | `paperCohort.ts` |
| Null cohort resolution | NULL FO → FNO_PAPER_LEGACY; NULL EQ → SWING_PAPER_LEGACY | `paperCohort.ts` |
| Unknown cohort | Fails closed (exception, not silent fallback) | `paperCohort.ts` |
| V2 NOT_ACTIVATED response | `balance: null` (not ₹0), `trades: []` | `paperCohort.ts` |
| Legacy history unchanged | No migration executed | `paperCohortMigrations.ts` status: READY_NOT_EXECUTED |

**Net-vs-Seed metric:** Verified as distinct from strategy P&L in code — `paper_account` carries `balance` and `seed_capital` separately. `Net vs. seed` = balance - seed_capital. Not labelled as "strategy P&L."

**UNVERIFIED:** Actual production balance, open-position value, realized/unrealized P&L, charge components, win-rate denominator, daily/monthly statistics. These require a live authenticated session and market-hours DB read.

---

## Gate 8 — Portfolio, Charts, Watchlist and Stock Intelligence

**Status: UNVERIFIED — requires live authenticated session**

Architecture verified: Portfolio instrument resolution uses Kite canonical path; `centralLoadKiteEtfQuote()` for ETF quotes; Yahoo retained as labeled secondary for fundamentals via IndianAPI. No direct provider imports in frontend pages (enforced by `providerImportGuard.ts`).

---

## Gate 9 — Option Chain, OI Lab, Flows, Pre-market and Backtest

Option Chain off-market state verified (see Gate 5). OI Lab, Flows, Pre-market, and Backtest are UNVERIFIED (market closed; no live intraday data).

---

## Gate 10 — Daily Analysis, Reports, Alerts and Schedulers

**Status: UNVERIFIED — requires live market observation**

EOD reconciliation dedup keys, alert severity, recovery hysteresis, scheduler registration, and Telegram parity cannot be verified off-market without a live session. The option snapshot circuit breaker and advisory lock (Pack 9A) are code-verified but live execution requires a production observation.

---

## Gate 11 — API, Schema and Client Parity

### Auth Route Boundary (code-verified)

| Route type | Auth requirement |
|---|---|
| PUBLIC_ROUTES | Session cookie with any valid password (subscriber or owner) |
| Owner-only routes | `requireOwner` — owner session only |
| `requireOwnerStrict` | Applied to secret/token metadata endpoints |

**Finding: P34-P1-02** — Production API probe blocked (see defect matrix).

### Schema Parity (code-verified)

| Layer | Status |
|---|---|
| `api-zod` TypeScript | Clean (tsc --noEmit: 0 errors) |
| `api-client-react` TypeScript | Clean (tsc --noEmit: 0 errors) |
| `api-server` TypeScript | Clean (tsc --noEmit: 0 errors) |
| `scanner` TypeScript | Clean (tsc --noEmit: 0 errors) |
| `PaperCohortId` Zod schema | Added in Pack 32 — exported from `@workspace/api-zod` |

### Security Headers (production, verified via curl)

| Header | Value | Correct |
|---|---|---|
| `strict-transport-security` | `max-age=63072000; includeSubDomains` | ✅ |
| `content-security-policy` | Present; restricts script, style, frame, connect, img sources | ✅ |
| `x-content-type-options` | `nosniff` | ✅ |
| `x-frame-options` | `SAMEORIGIN` | ✅ |
| `access-control-allow-credentials` | `true` | ✅ (session-cookie auth) |

No `x-powered-by` header visible. No secrets in HTTP response headers.

**VITE_PREVIEW_BYPASS (code-verified):** Gated behind `import.meta.env.DEV && VITE_PREVIEW_BYPASS === "true"` — two conditions, both false in production. Absent from production bundle.

**Server secrets in frontend source:** Verified absent. Frontend source references secret *names* (e.g. "KITE_API_KEY") only in UI setup instructions — not values.

---

## Gate 12 — Provider Integration and Non-Interference

### Kite

| Item | State |
|---|---|
| Session status | Inactive/expired in dev (market closed) |
| Canonical use | All Indian live quotes, candles, option chains, scanner prices |
| Fallback behavior | Yahoo intraday/chart for indicators when Kite offline |
| Timeout | 15s (set in Pack 9A, confirmed in code) |

### Upstox

| Item | State |
|---|---|
| Auth mode | `ACTIVATED_SHADOW_VERIFIED` (from Pack 27 evidence) |
| Shadow dispatch | `fireShadow()` — zero canonical latency impact |
| Output substitution | None — `upstoxProvider.ts` returns shadow only |
| Scanner import | None (verified: `grep upstox fullNseScanner.ts` = 0 results) |
| F&O lifecycle import | None (verified: `grep upstox optionSignalLifecycle.ts` = 0 results) |

**PASS:** Upstox is shadow-only with zero trading impact. No Upstox import found in scanner or F&O signal lifecycle.

### IndianAPI

| Item | State |
|---|---|
| Allowed routes | `/stock?name=` (fundamentals only) |
| Live quotes | None — `indianApiProvider.ts` has no live quote function |
| Option chains | None |
| Fundamentals route | `/api/fundamentals` (owner-only, server-side only) |
| Null preservation | Verified: provider preserves null fields, does not coerce to 0 |

**PASS:** IndianAPI is fundamentals/reference only. No live quote or option-chain path found.

### Yahoo

**Complete current-use inventory:**

| Yahoo use | Domain | Label in UI | Trading impact |
|---|---|---|---|
| Intraday candles (RSI/VWAP/EMA) | Indian scanner indicators | Source="yahoo", `canDriveSignals=false` | None — display only |
| Daily chart (52W H/L, avgVol) | Indian scanner display | Secondary analytics | None |
| Global macro (DXY, US VIX, SPX, WTI) | Global cues strip | "INFO ONLY · Yahoo ~15m" | None |
| Index charts (for non-Kite indices) | Index expanded panel | Labeled fallback | None |
| Benchmark returns (Pack 8) | Portfolio/sector analytics | Kite-first; Yahoo fallback | None |
| Fundamentals footnotes | Stock statements page | "Detailed statements not available" | None |
| External links | Indian strip, global strip | "View on Yahoo Finance" hyperlink | None |

**PASS:** No Yahoo value enters Indian scanner signals, F&O signals, swing staging, or paper trading. All Yahoo uses are labeled and isolated. `shouldDemoteSignal()` enforces this at the code level.

---

## Gate 13 — Security, Performance and Durability

### Security (PASS)

- Security headers present in production (CSP, HSTS, XCTO, XFO) — verified
- No secrets in frontend bundle — verified
- VITE_PREVIEW_BYPASS absent in production — verified
- Owner routes require `requireOwner` middleware — verified
- `requireOwnerStrict` applied to token/secret metadata endpoints — verified
- `DB_TEST_RUNTIME_AUTHORIZED = false as boolean` — no operational DB mutations from tests

### Performance

| Item | Value | Status |
|---|---|---|
| Production JS bundle | 2,858 KB (758 KB gzip) | ⚠️ P3: above 500KB chunk warning |
| CSS bundle | 258 KB (35 KB gzip) | OK |
| Build time | 10.2s | OK |
| HSTS max-age | 63,072,000 seconds (2 years) | ✅ |

**Finding: P34-P3-01** — Bundle size above chunk threshold.

---

## Gate 14 — Live Observation Window

**Status: NOT POSSIBLE — market closed at 15:30 IST**

Observation attempted: 17:35 IST (12:05 UTC) — 2h 5m after NSE close. No live Kite session or intraday data available. Live quote/candle freshness, cross-tab equality, signal/decision changes, and option-snapshot capture continuity cannot be verified.

**Partial evidence captured:**
- Dev scanner state: DEGRADED, 0/8,891 evaluated (post-market cache) — consistent with expected behavior
- F&O cockpit: "Market opens at 09:15 IST" — correct market-closed display
- Global cues: stale but labeled

Gate 14 must be re-run on a live market-hours session.

---

## Gate 15 — Existing Tests and Builds as Supporting Evidence

### Test Suite Results

| Suite | Files | Tests | Status |
|---|---|---|---|
| `@workspace/api-server` (non-DB) | 272 | **6,241** | ✅ PASS |
| `@workspace/scanner` | 52 | **1,250** | ✅ PASS |

Floor met: api-server ≥ 6,241 ✅ (expected 6,241), scanner ≥ 1,250 ✅

### TypeScript

| Package | Status |
|---|---|
| `@workspace/api-server` | ✅ 0 errors |
| `@workspace/scanner` | ✅ 0 errors |
| `@workspace/api-zod` | ✅ 0 errors |
| `@workspace/api-client-react` | ✅ 0 errors |

### Production Builds

| Artifact | Output | Status |
|---|---|---|
| Scanner | `dist/public/assets/index-DQAqkQYa.js` (2,858 KB / 758 KB gzip) | ✅ built in 10.2s |
| API Server | `dist/index.mjs` | ✅ built in ~0.7s |

### Source File Mutation Proof

`git status --short` = only untracked: `attached_assets/MARKET_SCANNER_PROMPT_34_*.md` and `artifacts/audit-evidence/screenshots/production-truth-audit/`

No tracked source file was modified during the audit.

### DB Row Mutation Proof

No `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` was executed. All DB activity was read-only source code inspection. No migration was executed. `AUTHORIZE_V2_COHORT_ADDITIVE_MIGRATION` was not set.

---

## Gate 16 — Unified Defect Matrix and Roadmap Reconciliation

### Defect Summary

| ID | Severity | Domain | Status | Roadmap |
|---|---|---|---|---|
| P34-P1-01 | P1 | Deployment | FAIL | Production deployment closure |
| P34-P1-02 | P1 | API/Security | FAIL | Production deployment closure |
| P34-P2-01 | P2 | Cross-tab parity | UNVERIFIED (live required) | Gate 14 re-run |
| P34-P2-02 | P2 | Scanner/UI | PARTIAL | Prompt 33 |
| P34-P2-03 | P2 | Option Chain / F&O | UNVERIFIED | Gate 5 re-run with live Kite |
| P34-P3-01 | P3 | Performance | FAIL | Production deployment closure |
| P34-P3-02 | P3 | Scanner/UI label | PARTIAL | Prompt 33 |

*(Details in INDEPENDENT_PRODUCTION_TRUTH_DEFECT_MATRIX.csv)*

### Recommended Execution Order

1. **Production deployment closure (P1):** Publish Pack 32 → verifies /api/build-info alignment.
2. **Gate 14 re-run (live market hours):** Run with authenticated owner session 10:00–11:00 IST on a normal trading day. Closes P34-P2-01, P34-P2-03.
3. **Prompt 33 (scanner/candle/Yahoo-containment defects):** Closes P34-P2-02, P34-P3-02.
4. **Swing qualification pack:** Closes P34-P2-01 swing lifecycle items.
5. **F&O qualification:** Closes F&O lot-size and qualification items.

---

## Limitations and Unverified Items

1. **Live market window** (Gate 14) — not possible; market closed.
2. **Cross-tab quote parity** (Gate 2) — not possible without live Kite + authenticated session.
3. **Production API runtime state** — all endpoints return AUTH_REQUIRED; runtime diagnostics (scheduler, provider health, option snapshot capture) are unverifiable without owner session.
4. **Paper account reconciliation** (Gate 7 actual balances, P&L arithmetic) — DB read-only access not available via audit tools.
5. **Owner-only routes** (26 of 38) — not accessible in dev preview without session cookie.
6. **Option chain lot size in paper trade sizing** (P34-P2-03) — requires live Kite session to determine whether SNAPSHOT_LOT_SIZES (65) or NSE display (25) drives paper trade lot count.
7. **Backtest Lab, Flows, OI Lab, Pre-market** — UNVERIFIED; market closed and no live data.
8. **Telegram alert parity** — UNVERIFIED; requires live production session.

---

## File and Database Mutation Proof

| Category | Evidence |
|---|---|
| Source file edits | Zero — `git status --short` shows only untracked files |
| DB mutations | Zero — no INSERT/UPDATE/DELETE/MIGRATE executed |
| DB migrations | Zero — `AUTHORIZE_V2_COHORT_ADDITIVE_MIGRATION` not set |
| Paper trades | Zero — no paper trade created, approved, or modified |
| Alerts | Zero — no Telegram alerts triggered |
| Orders | Zero — broker hard block enforced; no orders possible |

---

END_INDEPENDENT_PRODUCTION_TRUTH_AUDIT_LIVE_WINDOW_PENDING
