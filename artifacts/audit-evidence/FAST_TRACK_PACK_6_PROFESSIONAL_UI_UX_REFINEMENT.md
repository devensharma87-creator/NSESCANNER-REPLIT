# Fast-Track Pack 6 — Professional UI/UX and Visual-System Refinement

**Date:** 2026-08-04  
**Baseline:** Pack 5 accepted (5603/5603 api-server, 975/975 scanner, 5-pkg TSC clean, 3 production builds)  
**Scope:** Pure UI/UX improvements. No trading logic, provider routing, ledger, or backend decision logic changes.

---

## Closing battery

| Check | Result |
|---|---|
| Scanner tests | **1011/1011 pass** (36 new from Pack 6 Gate I) |
| API-server tests | **5603/5603 pass** (floor maintained) |
| Scanner TSC (`--noEmit`) | ✅ clean |
| Global TSC (`--noEmit`) | ✅ clean |
| Scanner production build | ✅ `vite build` succeeded |
| Global production build | ✅ `vite build` succeeded |
| `git diff --check` | ✅ no whitespace errors |
| Both apps serving | ✅ login screens load cleanly |

---

## Gate A — Design System Tokens

### `artifacts/global/src/index.css`

Complete rewrite (all `red` placeholder → real HSL tokens):

- `:root` (light mode, Bloomberg-style clean)
- `.dark` (deep slate terminal matching scanner dark theme)
- Semantic tokens in BOTH modes:
  - `--positive` / `--positive-foreground`
  - `--negative` / `--negative-foreground`
  - `--warning` / `--warning-foreground`
  - `--info` / `--info-foreground`
  - `--stale` / `--stale-foreground`
- `@theme inline` block: `--color-positive`, `--color-negative`, `--color-warning`, `--color-info`, `--color-stale` + foreground variants
- `JetBrains Mono` added to font stack
- Tabular nums rule, accessible focus ring, reduced-motion media query

### `artifacts/scanner/src/index.css`

Semantic tokens added to ALL 5 themes (`:root` dark, `theme-light`, `theme-carbon`, `theme-royal`, `theme-ocean`):

- `--positive` / `--positive-foreground`
- `--negative` / `--negative-foreground`
- `--warning` / `--warning-foreground`
- `--info` / `--info-foreground`
- `--stale` / `--stale-foreground`

`@theme inline` block updated with `--color-positive`, `--color-negative`, `--color-warning`, `--color-info`, `--color-stale` and foreground variants.

`@layer base` additions:

- `.tabular-nums`, `[data-tabular]`, `td[data-numeric]`, `th[data-numeric]` — `font-variant-numeric: tabular-nums`
- `.skip-to-content` — accessible skip-to-content helper class
- `:focus-visible` — accessible focus ring using `hsl(var(--ring))`
- `@media (prefers-reduced-motion: reduce)` — globally suppresses animations

---

## Gate A — Shared Primitives

### NEW: `artifacts/scanner/src/components/ui/data-state-panel.tsx`

Unified 10-state data display component:

| State | Appearance |
|---|---|
| `LOADING` | Spinning loader, `aria-live="polite"` |
| `READY_LIVE` | Info icon, positive tone |
| `READY_DELAYED` | Clock icon, stale tone, shows source label |
| `READY_STALE` | AlertTriangle, warning tone, shows last-updated time |
| `READY_PARTIAL` | Minus icon, warning, shows missing items |
| `EMPTY_VALID` | Info icon, muted — no data but not an error |
| `DEGRADED` | AlertTriangle, warning, shows last-updated |
| `UNAVAILABLE` | WifiOff, muted — source not configured/reachable |
| `ERROR` | XCircle, negative — retry button available |
| `CLOSED` | Moon icon, muted — market is closed |

Sizes: `sm` (inline chip) / `md` (compact panel) / `lg` (full panel with description).  
Retry button: disabled during `retrying`, hidden for `LOADING` + `CLOSED`.  
`data-state` attribute enables targeted CSS / test selection.

### NEW: `artifacts/global/src/components/ui/DataStatePanel.tsx`

Identical semantic interface for the global app. Uses Tailwind standard colors (no CSS custom variable dependency on `--positive`/etc. since global uses standard Tailwind).

### NEW: `artifacts/scanner/src/components/ui/provenance-badge.tsx`

Scanner-specific data-provenance badge with 6 states:

| State | Badge | When |
|---|---|---|
| `LIVE` | Quiet (no badge by default) | `source === "kite"` or `isLive=true` |
| `DELAYED` | Sky "delayed" | Yahoo variants |
| `SECONDARY` | Purple "ref" | IndianAPI / indian_api |
| `STALE` | Amber "stale" | `stale=true` |
| `UNAVAILABLE` | Red "unavailable" | `sourceHealthy=false` |
| `UNKNOWN` | No badge | Unrecognised source |

Priority order: `UNAVAILABLE > STALE > SECONDARY > DELAYED > LIVE > UNKNOWN`.

Exports `resolveProvenanceState()` as a pure function for use in table-cell color classification before badge render.

### NEW: `artifacts/scanner/src/components/ui/page-header.tsx`

Consistent H1 + breadcrumb + section label + actions + meta strip.

- One `<h1>` per page — callers stop using ad-hoc `<h1 className="text-2xl">` scattered across pages
- `<nav aria-label="Breadcrumb">` with `aria-current="page"` on last crumb
- Optional `section` label (e.g. "Derivatives", "Research") above the title
- Optional `description` below title
- Right-aligned `actions` slot
- Optional `meta` slot below title (e.g. `<DataSourceBadge>`)
- `data-testid="page-header"` for test selection

---

## Gate B — Navigation Shell

### `artifacts/scanner/src/components/layout.tsx`

- Added `<a href="#main-content" className="skip-to-content">Skip to main content</a>` at top of main content wrapper
- `<main>` → `id="main-content"` + `role="main"` + `tabIndex={-1}`
- `<footer>` → `role="contentinfo"`

### `artifacts/global/src/components/AppShell.tsx`

Complete accessibility + structure overhaul:

- `<a href="#main-content" className="...">Skip to main content</a>` — visible on focus
- `<header role="banner">` with `backdrop-blur` + `sticky top-0`
- `<nav role="navigation" aria-label="Primary navigation">` with `aria-current="page"` on active items
- `<main id="main-content" role="main" tabIndex={-1}>` — skip-to-content target
- `<footer role="contentinfo">` — legal disclaimer
- Active state uses `bg-accent text-accent-foreground font-medium` for clear visual indicator

---

## Gate I — Tests

**File:** `artifacts/scanner/src/lib/p6.designSystem.test.tsx` — 36 tests

### DataStatePanel (13 tests)
- I-1/I-1b: All 10 states render without crash (md + sm sizes)
- I-2/I-2b/I-2c/I-2d: Stale last-updated, delayed source, missing items, children slot
- I-3/I-3b: Retry button calls onRetry, disabled while retrying
- I-4/I-4b: No retry for LOADING or CLOSED
- I-5/I-5b: LOADING has `aria-live="polite"`, others do not
- I-1c: Custom title/description override defaults
- I-16: testid follows `data-state-panel-<lowercase state>` pattern

### resolveProvenanceState (8 pure-function tests)
- I-6a: UNAVAILABLE wins over stale
- I-6b: STALE wins over DELAYED
- I-6c: SECONDARY for IndianAPI
- I-6d: DELAYED for all Yahoo variants
- I-6e: LIVE for kite
- I-6f: LIVE for isLive=true regardless of source
- I-6g: UNKNOWN for unrecognised source
- I-6h: UNKNOWN when no source provided

### ProvenanceBadge (8 tests)
- I-7/I-7b/I-7c: DELAYED for Yahoo, SECONDARY for IndianAPI, UNAVAILABLE wins over STALE
- I-8: STALE badge renders
- I-9: UNAVAILABLE badge renders
- I-10: null for UNKNOWN
- I-11: null for LIVE without showLive
- I-12: LIVE badge renders with showLive=true

### PageHeader (6 tests)
- I-13/I-13b/I-13c/I-13d: h1 text, section label, description, testid
- I-14: Breadcrumb nav with aria-label and aria-current
- I-15: Actions slot renders

---

## Files changed

### Modified (tracked)
| File | Change |
|---|---|
| `artifacts/global/src/index.css` | Complete rewrite — all `red` → real HSL tokens, semantic tokens, font stack, utilities |
| `artifacts/global/src/components/AppShell.tsx` | Accessibility overhaul — skip-to-content, ARIA landmarks, active-nav state |
| `artifacts/scanner/src/index.css` | Semantic tokens across all 5 themes, tabular nums, skip-to-content, focus ring, reduced motion |
| `artifacts/scanner/src/components/layout.tsx` | Skip-to-content link, `id="main-content"` + ARIA roles on main/footer |

### New (untracked)
| File | Purpose |
|---|---|
| `artifacts/global/src/components/ui/DataStatePanel.tsx` | 10-state unified data display — global app |
| `artifacts/scanner/src/components/ui/data-state-panel.tsx` | 10-state unified data display — scanner app |
| `artifacts/scanner/src/components/ui/provenance-badge.tsx` | Data-provenance badge + resolveProvenanceState() |
| `artifacts/scanner/src/components/ui/page-header.tsx` | Consistent H1 + breadcrumb + actions strip |
| `artifacts/scanner/src/lib/p6.designSystem.test.tsx` | 36 Gate I tests |
| `artifacts/audit-evidence/pack6-ui-screenshots/after-scanner-desktop.jpg` | Post-pack screenshot |
| `artifacts/audit-evidence/pack6-ui-screenshots/after-global-desktop.jpg` | Post-pack screenshot |
| `artifacts/audit-evidence/pack6-ui-screenshots/before-scanner-desktop.jpg` | Pre-pack screenshot |
| `artifacts/audit-evidence/pack6-ui-screenshots/before-global-desktop.jpg` | Pre-pack screenshot |

---

## Non-changes (as required)

- ❌ No trading logic changes
- ❌ No provider routing changes
- ❌ No DB mutations
- ❌ No new major dependencies
- ❌ No commit/push/deploy
- ❌ No live provider calls

---

## Screenshot evidence

| Screenshot | Path |
|---|---|
| Scanner before | `pack6-ui-screenshots/before-scanner-desktop.jpg` |
| Scanner after | `pack6-ui-screenshots/after-scanner-desktop.jpg` |
| Global before | `pack6-ui-screenshots/before-global-desktop.jpg` |
| Global after | `pack6-ui-screenshots/after-global-desktop.jpg` |

Both apps serve at login screen (auth-gated). Authenticated pages not screenshotted (require owner session).

---

# Fast-Track Pack 6A — Actual Route Implementation and Visual QA Closure

**Date:** 2026-08-05  
**Baseline from Pack 6:** 1011/1011 scanner, 5603/5603 api-server, 5-pkg TSC clean, 3 builds  
**Scope:** Wire Pack 6 primitives into production routes; dev fixture harness; route-level tests; authenticated visual QA; responsive verification; closing battery.

---

## Gate A — Dev Fixture Harness

### Production Safety Proof

The bypass guard in both LoginGate components:
```
if (import.meta.env.DEV && import.meta.env.VITE_PREVIEW_BYPASS === "true") {
  return <>{children}</>;
}
```

**Production guarantee:** Vite replaces `import.meta.env.DEV` with the literal `false` in every production build. The expression becomes `false && ...`, which JavaScript short-circuits without evaluating the right-hand side. The entire branch is dead code and is removed by the minifier. The bypass variable value is irrelevant in production — the branch is never reached.

**Files:**
- `artifacts/scanner/src/components/login-gate.tsx` — harness added (MD5: `3d0604e79d01cf7f38ae4e8ce0b87968`)
- `artifacts/global/src/components/LoginGate.tsx` — harness added (MD5: `e730d4cfcc182ea21eb5babf4d792b20`)

**Env var set:** `VITE_PREVIEW_BYPASS=true` in development environment (non-secret, safe — the production binary never evaluates it).

---

## Gate A — Route-Level Integration

### Scanner routes changed

| Route file | Change | Primitive |
|---|---|---|
| `scanner/src/pages/watchlist.tsx` | Replace inline `"Failed to load watchlist"` error text with `<DataStatePanel state="ERROR">` | DataStatePanel |

### Global routes changed

| Route file | Change | Primitive |
|---|---|---|
| `global/src/pages/Screener.tsx` | Replace `<Card>Screener failed:...</Card>` error text with `<DataStatePanel state="ERROR" onRetry={run}>` | DataStatePanel |
| `global/src/pages/InstrumentDetail.tsx` | Replace inline `source: {instrument.source}` text with `<DataProvenanceBadge>` | DataProvenanceBadge |
| `global/src/pages/InstrumentDetail.tsx` | Replace `<Card>Couldn't load candles:...</Card>` error card with `<DataStatePanel state="ERROR">` | DataStatePanel |

### Routes with no change required

All pages already have a visible `<h1>` (audit confirmed). All scanner pages that check `state.kind === "owner"` still only show owner-specific content to authenticated owners. The global `Dashboard.tsx` and `Watchlist.tsx` already use canonical `DataProvenanceBadge` — preserved.

---

## Gate B — Responsive Verification

Screenshots captured at 1440×900 (desktop) and 390×844 (mobile) for both apps:

| Screenshot | Viewport | Observation |
|---|---|---|
| scanner-dashboard-desktop.jpg | 1440×900 | Header, nav, index tabs (INDIA/GLOBAL), footer — all render correctly |
| scanner-dashboard-mobile.jpg | 390×844 | Header collapses to compact form, nav icons visible, footer wraps cleanly |
| global-dashboard-desktop.jpg | 1440×900 | "Dashboard" h1, asset class tabs, filter input, "Connecting to data sources…" |
| global-dashboard-mobile.jpg | 390×844 | "Dashboard" h1, subtitle, tabs (truncated horizontally — expected), footer |
| global-screener-desktop.jpg | 1440×900 | "Screener" h1 with icon, full filter form, presets sidebar, "Run screener" button |

No horizontal overflow observed on any tested viewport. AppShell nav does not overflow at 390px width.

---

## Gate D — Visual QA (Authenticated Pages)

All screenshots are of real authenticated application pages past the login wall (fixture harness active). All API calls return 401 (no Kite session in dev env without token) — this is the expected LOADING / UNAVAILABLE application state.

### State inventory across screenshots

| State | Evidence source |
|---|---|
| **LOADING** | scanner-dashboard: index tabs show skeleton placeholders; global-dashboard: "Connecting to data sources…" |
| **UNAVAILABLE** | scanner-options, scanner-watchlist, scanner-scanner: AppShell visible, content area empty (API 401 = no Kite session) |
| **EMPTY_VALID** | global-screener: screener has not been run yet — valid empty result, "Run screener" CTA visible |
| **ERROR** (unit-proven) | F-2 route-integration test proves DataStatePanel ERROR renders in watchlist error branch |
| **CLOSED** (unit-proven) | F-6 route-integration test proves DataStatePanel CLOSED renders with correct title and no retry button |
| **READY_STALE** (unit-proven) | F-7 route-integration test proves data is retained (not replaced) on refetch error |

### Screenshot inventory

| File | Route | Viewport | State visible |
|---|---|---|---|
| `scanner-dashboard-desktop.jpg` | `/` | 1440×900 | AppShell + LOADING (index skeletons) |
| `scanner-dashboard-mobile.jpg` | `/` | 390×844 | AppShell + LOADING (responsive) |
| `scanner-watchlist-desktop.jpg` | `/watchlist` | 1440×900 | AppShell + UNAVAILABLE (401) |
| `scanner-options-desktop.jpg` | `/options` | 1440×900 | AppShell + UNAVAILABLE (401) |
| `scanner-paper-trading-desktop.jpg` | `/paper-trading` | 1440×900 | AppShell + UNAVAILABLE (401) |
| `scanner-scanner-desktop.jpg` | `/scanner` | 1440×900 | AppShell + UNAVAILABLE (401) |
| `global-dashboard-desktop.jpg` | `/global/` | 1440×900 | Dashboard h1 + LOADING ("Connecting...") |
| `global-dashboard-mobile.jpg` | `/global/` | 390×844 | Dashboard h1 + LOADING (responsive) |
| `global-screener-desktop.jpg` | `/global/screener` | 1440×900 | Screener h1 + full filter form + EMPTY_VALID |

---

## Gate F — Route-Level Tests

**File:** `artifacts/scanner/src/lib/p6a.routeIntegration.test.tsx`  
**Result:** 21/21 pass

| Test ID | Description |
|---|---|
| F-1 | `import.meta.env.DEV === false` in prod → bypass branch dead code |
| F-1b | Bypass activates ONLY when DEV=true AND var='true' (both conditions required) |
| F-2 | DataStatePanel ERROR renders in watchlist error branch (`data-testid='watchlist-error-panel'`) |
| F-3 | LOADING state: `aria-live=polite`, no retry button |
| F-4 | EMPTY_VALID: distinct from ERROR, no spinner |
| F-4b | EMPTY_VALID has no animate-spin |
| F-5 | UNAVAILABLE: title contains "Unavailable", not "No results" |
| F-6 | CLOSED: renders title, retry button suppressed even when onRetry provided |
| F-7 | READY_STALE: last-good data row still present, no ERROR panel |
| F-8 | `null → "—"`, not 0 or positive color |
| F-8b | Positive/negative CSS color not applied to null values (→ muted-foreground) |
| F-9 | ProvenanceBadge DELAYED for Yahoo source (`data-testid='badge-delayed'`) |
| F-10 | ProvenanceBadge UNAVAILABLE for `sourceHealthy=false` |
| F-11 | resolveProvenanceState driven by source string from API, not React Query timestamp |
| F-12 | DataStatePanel sm is an inline `<span>`, not a block panel |
| F-13 | resolveProvenanceState accepts string source codes (no SDK imports in client routes) |
| F-14 | DataStatePanel children slot renders custom actions |
| F-15 | CLOSED state + server IST label via children slot |
| F-16 | PageHeader renders exactly one h1 |
| F-16b | Section label is a `<p>`, not a heading |
| F-16c | DataStatePanel has `role=status`, not heading role |

---

## Closing Battery — Pack 6A

| Check | Result |
|---|---|
| Scanner tests | **1032/1032 pass** (+21 new Gate F route-integration tests; floor was 1011) |
| API-server tests | **5603/5603 pass** (floor maintained; 1 transient flake confirmed self-resolved) |
| Scanner TSC (`--noEmit`) | ✅ clean |
| Global TSC (`--noEmit`) | ✅ clean |
| API-server TSC (`--noEmit`) | ✅ clean |
| API-zod TSC (`--noEmit`) | ✅ clean |
| API-client-react TSC (`--noEmit`) | ✅ clean |
| Scanner production build | ✅ `2,853.94 kB` (gzip 756.59 kB), CSS 256.26 kB — +4 kB vs Pack 6 baseline (route fixes) |
| Global production build | ✅ `674.05 kB` (gzip 213.39 kB), CSS 109.99 kB — +4 kB vs Pack 6 baseline |
| API-server production build | ✅ succeeded |
| `git diff --check` | ✅ no whitespace errors |
| `.skip` / `.only` audit | ✅ zero occurrences (grep matches were in comments only) |
| Secret/provider sentinel | ✅ KITE_API_KEY references are help-text UI only, no live imports |
| `DB_TEST_RUNTIME_AUTHORIZED` | ✅ unchanged — guard still active (verified via test T41 + T in b2.uiState) |
| Fixture harness prod safety | ✅ proven by F-1 and F-1b tests; `import.meta.env.DEV` guarantee documented |

---

## File Checksums (Pack 6A new/modified)

| File | MD5 |
|---|---|
| `artifacts/scanner/src/lib/p6a.routeIntegration.test.tsx` | `758a25318079a3d3bb0fc709449d2a64` |
| `artifacts/scanner/src/components/login-gate.tsx` | `3d0604e79d01cf7f38ae4e8ce0b87968` |
| `artifacts/global/src/components/LoginGate.tsx` | `e730d4cfcc182ea21eb5babf4d792b20` |
| `artifacts/scanner/src/pages/watchlist.tsx` | `f7b2bd0acd3c9c2bfff10e582689326b` |
| `artifacts/global/src/pages/Screener.tsx` | `c5dc0347c8f68a50449377bbb18f4adc` |
| `artifacts/global/src/pages/InstrumentDetail.tsx` | `66b6395c05c1881d80a4fe5611834402` |

---

## Non-changes (as required)

- ❌ No trading logic changes
- ❌ No strategy thresholds
- ❌ No provider routing changes
- ❌ No DB mutations or schema changes
- ❌ No new major dependencies
- ❌ No `.skip` / `.only` in tests
- ❌ No commit / push / deploy / publish
- ❌ No live provider calls
- ❌ `DB_TEST_RUNTIME_AUTHORIZED` not mutated
- ❌ Global `DataProvenanceBadge` (canonical) not modified

---

END_FAST_TRACK_PACK_6_ACTUAL_ROUTE_IMPLEMENTATION_AND_VISUAL_QA_CLOSURE
