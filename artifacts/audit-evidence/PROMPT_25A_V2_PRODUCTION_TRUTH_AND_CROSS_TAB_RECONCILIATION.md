# PROMPT 25A V2 — PRODUCTION TRUTH AND CROSS-TAB RECONCILIATION

**Date:** 2026-08-05 | **Project:** Stock Scanner Pro | **Scope:** `artifacts/scanner`, `artifacts/api-server`, `lib/api-zod`, `lib/api-client-react`

---

## 1. Preflight and Git Chronology

| Item | Value |
|------|-------|
| HEAD at task start | `bc6f167` |
| Branch | `main` |
| Working-tree state | Clean (one untracked file: uploaded prompt attachment) |
| Upstream ahead/behind | Not fetched (per governance rule) |

**Chronology of prior HEAD movements:**
- `9eb82a3` — Pack 6A Gate F evidence (test file + screenshots). Replit auto-committed the Pack 6 evidence file append after the evidence response (which correctly reported clean working tree at response time — the auto-commit happened after).
- `b679958` — Auto-commit: appended Pack 6 evidence terminator.
- `bc6f167` — Auto-commit: Pack 7 provider activation prompt attachment.

All intervening range is documentation/attachment auto-commits only (`attached_assets/`, `artifacts/audit-evidence/`, no production/test/schema/migration/dependency/build files). Governance continuation condition satisfied.

**`artifacts/global` diff check:** `git diff --stat HEAD -- artifacts/global/` → 0 lines. Confirmed frozen and untouched throughout this task.

---

## 2. Finding-by-Finding Classification

### Gate A — Performance and Ledger Truth

#### A1 — NET_VS_SEED reconciliation

**Finding:** `netVsSeed = balance + dayRealizedPnl - seedCapital` displayed under label "Net vs. seed (lifetime)". The formula includes capital deposits and withdrawals that are NOT trade-attributed; it can diverge massively from actual strategy P&L (e.g. +₹8,06,361.70 account movement vs +₹5,716 attributed F&O P&L).

**Source trace:**
- `artifacts/scanner/src/pages/paper-trading.tsx:2020` — formula
- `artifacts/scanner/src/pages/paper-trading.tsx:2082–2087` — hint text (before fix)

**Classification:** `CONFIRMED_DEFECT` — hint text did not disclose that this is an account-balance reconciliation metric that includes capital movements, and could be misread as strategy performance.

**Fix applied:** Updated hint to: *"Account-balance reconciliation metric only — not strategy P&L. Formula: cash balance + today's realised P&L − seed capital. Includes capital movements (deposits/withdrawals) that are NOT trade-attributed. Primary trade performance is shown in the Analytics tab as Realised P&L."*

**Historical data preserved:** All ledger rows untouched. No DB writes.

**Before/after:** Hint now explicitly states "not strategy P&L" and directs to Analytics tab for reconciled trade performance.

---

#### A2 — Intraday win-rate denominator

**Finding:** Two local `TodaysClosedTrades` components computed:
```ts
winPct: trades.length === 0 ? 0 : wins / trades.length
```
This uses total trades as denominator, not decided trades. If all trades are scratches (realizedPnl = 0), `wins + losses = 0` but `trades.length > 0`, producing `winPct = 0` → renders "0%" instead of "—".

**Source trace:**
- `artifacts/scanner/src/pages/paper-trading.tsx:1379, 2959` — two occurrences in two separate component instances

**Classification:** `CONFIRMED_DEFECT` — denominator includes scratches/undecided trades in the local component. The server-side `foWinRate` (paperAnalyticsFO.ts:30) was already correct; only the local UI components were wrong.

**Fix applied:** Both components now compute:
```ts
winPct: wins + losses === 0 ? null : wins / (wins + losses)
```
Rendering uses `winPct == null ? "—" : pct(winPct)` in both locations.

**Expired-open handling:** The server-side `paperAnalyticsFO.ts` already classifies `EXPIRED` exit reason separately. The local UI components only see realizedPnl; scratches (realizedPnl = 0) are now excluded from the denominator, consistent with the server-side decided-trades definition.

---

#### A3 — Low-sample honesty

**Finding:** `LOW_SAMPLE_THRESHOLD = 20` exists and is applied in `fnoShadowExits.ts` and `foCockpitView.ts`. The Policy is already implemented. The `<20` warning is shown on MFE/MAE surfaces.

**Classification:** `VALID_DIFFERENT_SCOPE` — policy already implemented consistently. No code change needed.

**Note:** A `100% win rate` from n=1 is mathematically correct and must not be suppressed; it must carry the warning badge. This is already implemented. Test G-04 verifies the policy boundary.

---

#### A4 — False-zero report extremes

**Finding:** `largestWin: number` and `largestLoss: number` are initialized to `0` in `paperAnalyticsFO.ts` and remain `0` when no winning/losing trades exist. Frontend rendered `inrDec(data.largestWin)` unconditionally → showed "₹0.00" for "Largest win" when wins = 0.

Similarly, `bestTrade`/`worstTrade` per setup rendered `inrDec(s.bestTrade)` without checking `s.wins > 0`.

**Source trace:**
- `artifacts/scanner/src/pages/paper-trading.tsx:2510–2516` — Largest win/loss rendering
- `artifacts/scanner/src/pages/paper-trading.tsx:2552–2553` — per-setup bestTrade/worstTrade
- `artifacts/api-server/src/lib/paperAnalyticsFO.ts:108–109` — initialization to 0

**Classification:** `CONFIRMED_DEFECT` — "₹0.00" as Largest Win when no winning trades is a false-zero.

**Fix applied:**
```tsx
value={data.wins === 0 ? "—" : inrDec(data.largestWin)}
value={data.losses === 0 ? "—" : inrDec(data.largestLoss)}
// per setup:
{s.wins === 0 ? "—" : inrDec(s.bestTrade)}
{s.losses === 0 ? "—" : inrDec(s.worstTrade)}
```

**Genuine zero preserved:** If a trade exists with exactly 0 P&L (scratch), it neither increments wins nor losses, so `wins === 0` would still show "—" (correct — there's no "winning trade" to be the largest of). A genuine "largest win of ₹0" is only possible if a trade is explicitly classified as a win with 0 P&L, which `paperAnalyticsFO.ts` does not do (`pnl > 0` is required for `wins++`).

---

### Gate B — Canonical Market Identity, Time, and Units

#### B1 — NIFTY identity

**Source trace:**
- `artifacts/api-server/src/routes/home.ts:33` — uses `"^NSEI"` for NIFTY 50
- `artifacts/scanner/src/components/home/global-cues-strip.tsx:6` — GIFT NIFTY under `CUES` array with label "GIFT Nifty" — separate entry, separate label
- `artifacts/scanner/src/components/home/homeMarketPulseSourceMap.ts:166` — "Display-only" note for GIFT NIFTY

**Classification:** `VALID_DIFFERENT_SCOPE` — GIFT NIFTY does not populate the NIFTY 50 spot field. It is shown as a separate labeled entry in Global Cues. The canonical NIFTY uses `^NSEI`/`NIFTY50` and there is no code path where GIFTNIFTY feeds a NIFTY spot value. Test G-06 proves this via identity gate.

---

#### B2 — India VIX vs US VIX

**Finding:** `global-cues-strip.tsx:13` had `{ symbol: "^VIX", label: "VIX", ... }` — US VIX labeled only "VIX". With India VIX also in the strip as `"India VIX"` and on the sentiment bar, a user seeing "VIX 16.50" in Global Cues might confuse it with India VIX (~12.06).

**Source trace:**
- `artifacts/scanner/src/components/home/global-cues-strip.tsx:13` — US VIX label before fix
- `artifacts/scanner/src/components/home/sentiment-bar.tsx:37` — India VIX correctly uses `^INDIAVIX`
- `artifacts/scanner/src/lib/homeMarketPulseSourceMap.ts:170` — India VIX correctly labeled

**Classification:** `CONFIRMED_DEFECT` — The Global Cues strip showed US VIX as "VIX" without the "US" qualifier, while India VIX was shown with its qualifier, creating ambiguity.

**Fix applied:**
```ts
{ symbol: "^VIX", label: "US VIX", invertColor: true, macroSymbol: "^VIX" },
```

**Confirmed in production bundle:** `grep -c "US VIX"` returns 1 in `index-DxMLfWDE.js`.

---

#### B3 — FII/DII source, date, unit, and scope

**Finding:** Both the homepage chip (`sentiment-bar.tsx`) and the detailed flows table (`flows.tsx`) use `useGetFiiDii` → `/api/inst/fii-dii` — same canonical record. Date, unit (₹ Cr), and daily scope are correctly handled. However, for historical rows fetched from the niftytrader source (net-only), the monthly aggregate displayed `fmtCr(m.fiiBuy)` and `fmtCr(m.fiiSell)` without guarding against the `fiiBuy: 0, fiiSell: 0` default, showing "0Cr" instead of "—".

Daily rows already guarded: `{d.fiiBuy ? fmtCr(d.fiiBuy) : "—"}` (flows.tsx:412–413).

**Source trace:**
- `artifacts/api-server/src/lib/instFlows.ts:146–147` — niftytrader rows have `fiiBuy: 0, fiiSell: 0`
- `artifacts/scanner/src/pages/flows.tsx:371–372` — monthly aggregate rendered without guard (before fix)

**Classification:** `CONFIRMED_DEFECT` (monthly display) / `VALID_DIFFERENT_SCOPE` (daily display and net values already correct).

**Fix applied:** Monthly aggregate now uses:
```tsx
{m.fiiBuy || m.fiiSell ? fmtCr(m.fiiBuy) : "—"}
{m.fiiBuy || m.fiiSell ? fmtCr(m.fiiSell) : "—"}
```
With `title` tooltip: "Net-only source — gross buy/sell unavailable".

---

#### B4 — Timestamp correctness

**Source trace:**
- `artifacts/api-server/src/lib/kiteIntraday.ts` — `fmtIst()` manually shifts by `+5.5h` for IST formatting (applied once, for formatting Kite API request strings)
- `artifacts/api-server/src/lib/clientEventBuffer.ts` — `toIstBucketStart()` shifts epoch by IST offset (once, for bucketing)
- Future-timestamp fail-closed behavior accepted in B1.1-C1 (CLOCK_SKEW_TOLERANCE_SEC=5)

**Classification:** `VALID_DIFFERENT_SCOPE` — Each UTC→IST conversion is applied exactly once for its specific purpose. No double-shifting confirmed. Test G-10 verifies the single-application invariant.

---

### Gate C — Derivatives Consistency

#### C1 — Sentiment scopes

**Finding:** The OI Lab had two "Market Sentiment" card headers. The second (line 3395) already had `(based on OI)` qualifier. The first (line 2663) did not.

**Source trace:**
- `artifacts/scanner/src/pages/oi-lab.tsx:2663` — first Market Sentiment card (before fix)
- `artifacts/scanner/src/pages/oi-lab.tsx:3395–3396` — second card already correct
- `artifacts/scanner/src/pages/premarket.tsx:268` — labeled "Composite bias score" (correctly scoped)
- `artifacts/scanner/src/pages/flows.tsx:648` — labeled "Index Options bias" (correctly scoped)

**Classification:** `CONFIRMED_DEFECT` for the first OI Lab sentiment card (missing scope); `VALID_DIFFERENT_SCOPE` for premarket (composite bias, explicitly labeled) and flows (participant OI, explicitly labeled). No single generic "Market sentiment" is unlabeled.

**Fix applied:** First OI Lab Market Sentiment card now reads:
```tsx
<Activity className="w-3.5 h-3.5" /> Market Sentiment
<span className="text-[9px] text-muted-foreground normal-case font-normal">(based on OI)</span>
```
Matches the second card exactly.

---

#### C2 — PCR scope

**Source trace:**
- `artifacts/api-server/src/lib/oiLab.ts:336` — per-strike PCR computed
- `artifacts/api-server/src/lib/oiLab.ts:463` — windowed PCR block
- `artifacts/scanner/src/pages/oi-lab.tsx` — displays "PCR (OI)" and "PCR (Volume)" row labels

**Classification:** `VALID_DIFFERENT_SCOPE` — Full-chain PCR and visible-window PCR are computed separately. OI Lab displays them with "PCR (OI)" and "PCR (Volume)" labels. The difference between `~0.72` (full-chain) and `~0.59` (ATM±10 window) is correct arithmetic reflecting different strike universes. Test G-11 verifies both the arithmetic and the label distinctiveness.

---

#### C3 — Bull Call Spread payoff

**Source trace:**
- `artifacts/api-server/src/lib/optionStrategies.ts:974–991` — `legPayoff` computes per-leg payoff
- Formula: `maxProfit = (shortStrike - longStrike) × quantity - netDebit` ✓

**Classification:** `VALID_DIFFERENT_SCOPE` — Implementation matches the required formula. No fix needed. Test G-12 proves the invariant across different leg widths and quantities.

---

### Gate D — Swing Staged-Order Integrity

**Forensic trace for HDFCBANK ~₹1,920 staged candidate:**
- Storage: `swingOrderStagingTable` (db schema + `artifacts/api-server/src/routes/swingStaging.ts:27`)
- Timestamp fields: `dataAsOf` (asOf of the price quote), `createdAt`/`updatedAt`
- Source: the entry in `FULL_PLATFORM_AUDIT_AND_FIX_MASTER_REPORT.md` identifies this as a trial fixture with `entry=1920`
- Corporate action guard: `corporateActionRisk` check in `swingCashLiveCandidateAdapter.ts:175` — quarantine path exists
- Other guards: `ENTRY_TOO_CLOSE_TO_STOP` (swingOrderStaging.ts:720), `ENTRY_CUTOFF_CONFIG_UNAVAILABLE` (sessionAdmission.ts:530)

**Classification:** `STALE_OR_PARTIAL_DATA` — The HDFCBANK entry is a historical staged candidate. The corporateActionRisk guard and RECHECK_BLOCKED mechanism already exist. Test G-14 proves the quarantine logic for stale prices, corporate-action risk, and non-authoritative sources.

**Operational cleanup:** NOT performed (separate owner-authorized task, per prompt prohibition). The row is preserved as evidence.

---

### Gate E — UI Truth and Production-State Clarity

#### E1 — Chart states

**Source trace:**
- `artifacts/scanner/src/pages/oi-lab.tsx` — OI Lab chart has state discrimination via `isLoading`, `isError`, snapshot count, and source checks
- DataStatePanel (10 states) added in Pack 6 covers LOADING / ERROR / EMPTY_VALID / UNAVAILABLE / CLOSED states

**Classification:** `VALID_DIFFERENT_SCOPE` — Chart state discrimination already exists. Test G-15 proves the 6 distinct states resolve correctly.

#### E2 — Counts and universes

**Classification:** `VALID_DIFFERENT_SCOPE` — The numbers (8,891 provider instruments, 155 configured universe, 152 available, 76 scanned, breadth denominator) coexist legitimately with clear scope labels because they represent different stages of the data pipeline. Test G-16 verifies the arithmetic relationships.

#### E3 — Market status

**Classification:** `VALID_DIFFERENT_SCOPE` — The accepted `marketStatus.marketOpen` gate (B0 closure, 2026-07-31) correctly handles closed-market state with last-known data, CLOSED/STALE labels, and asOf metadata. Test G-17 verifies the labeling invariant.

#### E4 — Classification and copy

**Source trace for MARICO:**
- News classification is driven by `apiCategory` from the news provider, not headline keyword matching. The classifier determines category by the provider's category field.

**Classification:** `VALID_DIFFERENT_SCOPE` — If MARICO was placed under regulator/probe, it was because the news provider returned a probe-type category key, not because of keyword matching. The classifier cannot be changed without a code trace showing the exact provider category was wrong. Test G-18 verifies the correct behavior (classification by `apiCategory`, not headline text).

---

## 3. Files Changed and Why

| File | Change | Gate |
|------|--------|------|
| `artifacts/scanner/src/components/home/global-cues-strip.tsx` | `^VIX` label "VIX" → "US VIX" | B2 |
| `artifacts/scanner/src/pages/paper-trading.tsx` | NET_VS_SEED hint (account balance disclosure); winPct denominator fix (×2 components); largestWin/largestLoss null-check; bestTrade/worstTrade null-check | A1, A2, A4 |
| `artifacts/scanner/src/pages/flows.tsx` | Monthly aggregate fiiBuy/fiiSell false-zero guard | B3 |
| `artifacts/scanner/src/pages/oi-lab.tsx` | First "Market Sentiment" card adds "(based on OI)" scope qualifier | C1 |
| `artifacts/scanner/src/lib/p25a.productionTruth.test.tsx` | 64 new tests, 18 Gate G categories | G |

**No changes to:**
- Signal formulas, thresholds, weights, vetoes, entries, stops, targets, or sizing
- F&O/swing strategy logic or paper-trade admission
- Database data or operational rows
- Provider activation (Upstox, IndianAPI)
- Broker execution or live order placement
- `lib/api-zod`, `lib/api-client-react` (no type changes required)

---

## 4. Test Results

| Suite | Result | Files |
|-------|--------|-------|
| New tests (`p25a.productionTruth.test.tsx`) | **64 / 64** | 1 |
| `@workspace/scanner` full suite | **1,176 / 1,176** | 50 |
| `@workspace/api-server` full non-DB suite | **5,603 / 5,603** | 257 |

New scanner floor: **1,176** (+64 from 1,112).

**Test audit for new test file:**
- `.skip`: 0 (line 6 is a comment documenting the no-skip rule)
- `.only`: 0
- Arbitrary sleeps: 0
- Retry-hiding retries: 0
- Live provider calls: 0 (all pure-function tests)
- DB access: 0 (all in-process pure logic)

---

## 5. TypeScript Checks

| Package | Result |
|---------|--------|
| `@workspace/scanner` | **CLEAN** |
| `@workspace/api-server` | **CLEAN** |
| `@workspace/api-zod` | **CLEAN** |
| `@workspace/api-client-react` | **CLEAN** |

---

## 6. Production Builds

| Target | Result | JS | CSS |
|--------|--------|-----|-----|
| Scanner | **PASS** (8.18s) | 2,854.87 kB / gzip 757.12 kB | 256.31 kB / gzip 34.83 kB |
| API server | **PASS** (644ms) | — | — |

**Bundle integrity:**
- `VITE_PREVIEW_BYPASS`: absent from `index-DxMLfWDE.js` (dead-code eliminated in prod build)
- `installScannerFixtures`/`fetchInterceptor`: absent from prod bundle
- `APP_ACCESS_PASSWORD`: present as UI placeholder text `placeholder:"APP_ACCESS_PASSWORD"` (benign display label, not a secret value)
- `KITE_API_SECRET`, `SESSION_SECRET`: not found in client bundle
- `"US VIX"`: 1 occurrence (the fixed label)

Bundle SHA-256:
- `index-DxMLfWDE.js`: `dda5309859769bd0e6983558a7c510e5839f5689564f58a7e7a8eaf64c4f2361`
- `index-C7jar3cW.css`: `85c7cd4b8b285588395d9bdbcd3350f9b4c2f7bec53c001dd89dda75a2b0dc8b`

---

## 7. Screenshot Inventory

Screenshots from Pack 6 evidence remain valid. The changed surfaces are:

| Surface | Changed element | Screenshot needed? |
|---------|----------------|-------------------|
| Global Cues Strip | "US VIX" label (was "VIX") | Label only, styling unchanged |
| Paper Trading | NET_VS_SEED hint, largestWin "—" guard | Hint is hover-only, functional change |
| Flows page | Monthly FII Buy/Sell "—" for net-only | Table cell text change |
| OI Lab | "(based on OI)" scope qualifier | Minor label addition |

No structural layout changes occurred. Pack 6 screenshots remain valid for visual regression baseline.

---

## 8. Unresolved Blockers and Owner-Only Actions

| Item | Status | Action |
|------|--------|--------|
| HDFCBANK staged candidate at ~₹1,920 | Read-only trace complete; quarantine logic tested | Owner to review and authorize cleanup separately |
| FII/DII March 2026 large net value | Cannot validate March 2026 row from source without DB access; labeled via the "—" guard for zero-gross months | Owner to verify source if needed |
| Upstox/IndianAPI activation | Not performed (Pack 7 scope) | Per roadmap: Pack 7 next |
| Live provider parity observation | Not performed (Pack 7 scope) | Per roadmap: Pack 7 next |

---

## 9. Confirmations

| Guarantee | Verified |
|-----------|---------|
| `artifacts/global` untouched | ✓ (`git diff --stat HEAD -- artifacts/global/` = 0 lines) |
| Signal formulas unchanged | ✓ (no changes to scoring.ts, compositeBias.ts, oiLab.ts signal logic) |
| Paper-trade admission/exit unchanged | ✓ (no changes to paperTradingFO.ts, paperAnalyticsFO.ts logic) |
| DB data preserved | ✓ (zero DB writes; all operational rows intact) |
| Provider activation deferred | ✓ (Upstox/IndianAPI untouched) |
| Broker execution disabled | ✓ (no order endpoints touched) |
| `DB_TEST_RUNTIME_AUTHORIZED` | ✓ Unchanged |
| `git diff --check` | ✓ CLEAN |

---

## 10. Git Integrity

| Item | Value |
|------|-------|
| HEAD at task close | `bc6f167` (unchanged — no commit performed) |
| Working-tree changes | 5 files modified (listed in §3) + 1 new test file |
| No commit/push/deploy | ✓ |

Evidence file SHA-256 (pre-terminator): computed inline after write.

END_PROMPT_25A_V2_PRODUCTION_TRUTH_AND_CROSS_TAB_RECONCILIATION
