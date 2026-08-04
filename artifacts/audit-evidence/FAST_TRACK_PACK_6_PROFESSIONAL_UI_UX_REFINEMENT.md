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
