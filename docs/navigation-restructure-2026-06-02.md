# Navigation Restructure and Information Preservation Report

**Task:** Website Navigation Restructure — No Information Loss
**Date:** 2026-06-02
**Scope:** `artifacts/scanner` top-level navigation only. Presentation/information-architecture change. **No route, page, data, feature, auth, API, DB, schema, env, or scheduler change.**
**Status:** Implemented + reviewed. **NOT published** (awaiting review per task instruction).

---

## A. Current tabs found (pre-change, flat nav in `layout.tsx`)

Home, Scanner, Deep Scan, F&O Intraday, Strategies, Option Chain, OI Lab, Pre/Post, Watchlist, Sectors, FII/DII, To Watch, Charting, Portfolio, Market Info, Live Feed*, Learn, Audit*, Status*, Paper*, Reports*.
Plus two top-right quick-access chips: **ADMIN*** (`/admin`) and **INFRA*** (`/infra-health`).
`*` = owner-only.

## B. Current routes found (`App.tsx`)

| Route | Component | Access |
|---|---|---|
| `/` | Home | tab HOME |
| `/scanner` | Scanner | tab SCANNER |
| `/deep-scan` | DeepScan | tab DEEP_SCAN |
| `/option-chain`, `/option-chain/:underlying` | OptionChain | tab OPTION_CHAIN |
| `/oi-lab` | OiLab | tab OI_LAB |
| `/options` | Options | tab FNO |
| `/strategies` | Strategies | tab STRATEGIES |
| `/watchlist` | Watchlist | tab WATCHLIST |
| `/sectors`, `/sectors/:sector` | Sectors / SectorDetail | tab SECTORS |
| `/premarket` | PreMarket | tab PREMARKET |
| `/flows` | Flows (FII/DII cash) | tab FLOWS |
| `/stocks-to-watch` | StocksToWatch | tab STOCKS_TO_WATCH |
| `/charting` | Charting | tab CHARTING |
| `/portfolio-analyser` | PortfolioAnalyser | tab PORTFOLIO_ANALYSER |
| `/news` | News | tab NEWS |
| `/learn` | LearnPage | tab LEARN |
| `/kite` | KitePage (Live Feed) | **owner-only** |
| `/audit` | AuditPage | **owner-only** |
| `/status` | StatusPage | **owner-only** |
| `/admin` | AdminPage | **owner-only** |
| `/infra-health` | InfraHealthPage | **owner-only** |
| `/manifesto` | Manifesto | **owner-only** (pre-existing, NOT in nav — see P) |
| `/paper-trading` | PaperTrading | **owner-only** |
| `/paper-reports` | PaperReports | **owner-only** |
| `/stock/:symbol` | StockDetail | drill-down (subscriber-allowed) |
| `/index/:slug` | IndexDetail | drill-down (subscriber-allowed) |
| `/indices` | IndicesRedirect | redirect |
| `/legal/disclaimer`, `/legal/methodology`, `/legal/terms`, `/legal/privacy` | legal pages | public (bypass login) |
| `*` | NotFound | — |

**No route was added, removed, renamed, or re-pathed.**

## C. New grouped navigation implemented

Radix `DropdownMenu` groups + direct links (`layout.tsx`):

- **Home** — direct link `/`
- **Stock Intelligence** ▾ — Full Scanner, Deep Scan, Watchlist, Sector Rotation, To Watch
- **Derivatives** ▾ — Option Chain, OI Lab
- **Trading Desk** ▾ — F&O Intraday, Strategies, Paper Trading*, P&L Reports*
- **Market Pulse** ▾ — Pre / Post, Market Info, FII / DII, Live Feed*
- **Charting** — direct link `/charting`
- **Portfolio** — direct link `/portfolio-analyser`
- **Learn** — direct link `/learn`
- **Admin** ▾* — Admin Console, Audit, Status, Infra

`*` = owner-only (entire Admin group is owner-only; individual starred leaves owner-only). Each dropdown item shows a short **page-purpose label**; direct links carry it as a `title` tooltip.

## D. Old → new mapping table

| Old tab | Old route | New group | New menu label | Old route still works? | Alias/redirect added |
|---|---|---|---|---|---|
| Home | `/` | (top-level) | Home | ✅ | none |
| Scanner | `/scanner` | Stock Intelligence | Full Scanner | ✅ | none |
| Deep Scan | `/deep-scan` | Stock Intelligence | Deep Scan | ✅ | none |
| Watchlist | `/watchlist` | Stock Intelligence | Watchlist | ✅ | none |
| Sectors | `/sectors` | Stock Intelligence | Sector Rotation | ✅ | none |
| To Watch | `/stocks-to-watch` | Stock Intelligence | To Watch | ✅ | none |
| Option Chain | `/option-chain` | Derivatives | Option Chain | ✅ | none |
| OI Lab | `/oi-lab` | Derivatives | OI Lab | ✅ | none |
| F&O Intraday | `/options` | Trading Desk | F&O Intraday | ✅ | none |
| Strategies | `/strategies` | Trading Desk | Strategies | ✅ | none |
| Paper | `/paper-trading` | Trading Desk | Paper Trading (owner) | ✅ | none |
| Reports | `/paper-reports` | Trading Desk | P&L Reports (owner) | ✅ | none |
| Pre/Post | `/premarket` | Market Pulse | Pre / Post | ✅ | none |
| Market Info | `/news` | Market Pulse | Market Info | ✅ | none |
| FII/DII | `/flows` | Market Pulse | FII / DII | ✅ | none |
| Live Feed | `/kite` | Market Pulse | Live Feed (owner) | ✅ | none |
| Charting | `/charting` | (top-level) | Charting | ✅ | none |
| Portfolio | `/portfolio-analyser` | (top-level) | Portfolio | ✅ | none |
| Learn | `/learn` | (top-level) | Learn | ✅ | none |
| Admin (chip) | `/admin` | Admin | Admin Console (owner) | ✅ | chip retained too |
| Audit | `/audit` | Admin | Audit (owner) | ✅ | none |
| Status | `/status` | Admin | Status (owner) | ✅ | none |
| Infra (chip) | `/infra-health` | Admin | Infra (owner) | ✅ | chip retained too |

## E. Pages moved under each group
See C/D. Every previous nav item now lives under exactly one logical group (or remains a top-level link). No item was orphaned.

## F. Routes preserved
**All hrefs are byte-for-byte identical to the previous nav.** No route renamed; no deep link broken; no redirect/alias was needed (so none added). `/option-chain/:underlying` and `/sectors/:sector` sub-routes are unaffected (reached from within their pages).

## G. Admin/owner-only pages preserved
Owner-only leaves: Paper Trading, P&L Reports, Live Feed, Admin Console, Audit, Status, Infra — all tagged `ownerOnly: true`. The `canSee()` helper returns `false` for `ownerOnly` leaves for any non-owner, and a group renders only if ≥1 child is visible, so **non-owners see neither the owner-only leaves nor an empty Admin group**. Route-level `AccessGuard` in `App.tsx` is unchanged and remains the real enforcement boundary — nav is cosmetic. **No admin route was ever in public/user nav before or after.** No auth bypass; no public exposure.

## H. Empty-state fixes made
**None this phase (reported as recommendation).** Improving cross-page empty/loading/"market closed"/"data unavailable" states (Sectors, Watchlist, F&O Intraday, Home lower panels, etc.) requires editing multiple data pages and their fetch/loading branches — outside the safe nav-only scope. Recommended as a separate follow-up so trading-correctness surfaces are not touched here.

## I. Data-source badge consistency changes made
**None this phase (reported as recommendation).** Standardising Source / Freshness / Last-updated / Fallback wording (Kite / Yahoo delayed / Stale / Unavailable / Fallback / Market closed / Live) and removing any contradictory "Live + stale" pairing spans many pages' data layers. Recommended as a separate follow-up.

## J. Ticker strip changes made
**None.** Per the task's explicit guidance ("if implementation is not safe now, only report recommendation"), the ticker strip is untouched. Note: the Indian/Global ticker strips currently render only on `/` (Home). Recommendation for a future phase: compact/collapsible mode + consistent placement, implemented behind a safe, opt-in toggle.

## K. Files changed
- `artifacts/scanner/src/components/layout.tsx` — flat nav → grouped dropdowns + page-purpose labels (only functional change).
- `replit.md` — additive note (no trimming, per standing owner rule).
- `docs/navigation-restructure-2026-06-02.md` — this report.

## L. Tests run and results
- `pnpm --filter @workspace/scanner run typecheck` → **pass**.
- `pnpm --filter @workspace/scanner run test` → **395/395 pass** (13 files).
- Scanner workflow restarted; HMR hot-updated `layout.tsx` cleanly; app renders (login gate verified via screenshot). No new console errors attributable to this change.
- Architect code review (`includeGitDiff`) → **PASS**, no visibility/security regression.

## M. Confirmation: no data/information removed
Confirmed. This is a nav rendering reorganisation only. No table, metric, card, chart, filter, export button, freshness badge, explanation note, warning, or report section was removed from any page. No page internals were merged or edited.

## N. Confirmation: no trading/signal/paper/exit logic changed
Confirmed. No change to signal generation, F&O strategy logic, scanner scoring, paper-trade execution, stop/target/sizing, premium hard-stop/orphan-exit, market-data fetching, or Kite session/auth. Only `layout.tsx` nav markup changed.

## O. Confirmation: no DB/env/scheduler change
Confirmed. No DB schema/migration, no env/secret change, no scheduler change, no API response-shape change.

## P. Known limitations
1. **Admin Console + Infra appear in both** the new Admin dropdown and the existing top-right ADMIN/INFRA chips (intentional dual access — chips left untouched to avoid removing a feature). Optional future cleanup: drop the chips once the Admin dropdown is accepted.
2. **`/manifesto`** (owner-only) exists but was **not** in the nav before; it remains reachable by direct URL only. Deliberately left out of the Admin group to avoid surfacing a previously-hidden page — can be added on request.
3. **No separate pages exist** for "OI Heatmap / Delta Tracker", "FII/DII Participant OI", "Trade Journal", or "Events/Earnings/Holidays". Per the task ("do not create fake pages"), none were created — those capabilities live inside OI Lab, `/flows`, `/paper-reports`, and `/news` respectively.
4. Empty-state copy, data-source-badge wording consistency, and ticker compaction are **reported, not implemented** (sections H/I/J) — they fall outside the safe nav-only scope.
5. Visual verification past the login wall was limited (owner auth required for a full screenshot); correctness is otherwise established via typecheck, 395 unit tests, clean HMR, and architect review.

## Q. Whether safe to publish
The change is low-risk and review-clean (architect PASS; tests + typecheck green; no logic/route/auth/data change). **However, per the task's explicit instruction — "No publish until reviewed" / "Stop after the report" — this has NOT been published.** Recommended pre-publish checks: a quick owner + subscriber smoke test confirming group visibility and that no owner-only leaf appears for a non-owner.
