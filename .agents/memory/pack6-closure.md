---
name: Pack 6 closure — Professional UI/UX Refinement
description: What was shipped, what remains, and key design-system conventions established.
---

# Pack 6 — Professional UI/UX and Visual-System Refinement

**Status:** COMPLETE 2026-08-04  
**Baseline maintained:** api-server 5603, scanner 1011 (+36 new), 5-pkg TSC, 3 builds

## What was shipped

### Design tokens
- `global/src/index.css` — complete rewrite; ALL `red` placeholders replaced with real HSL tokens. Light (`:root`) + dark (`.dark`). Semantic tokens: `--positive`, `--negative`, `--warning`, `--info`, `--stale` (+ `-foreground`).
- `scanner/src/index.css` — semantic tokens added to all 5 themes (root/light/carbon/royal/ocean). `@theme inline` block updated. Tabular nums, skip-to-content class, accessible focus ring, reduced-motion media query.

### New shared components (scanner)
- `components/ui/data-state-panel.tsx` — 10-state panel (LOADING → CLOSED). sm/md/lg sizes. Use instead of ad-hoc "if isLoading return <Skeleton>" chains.
- `components/ui/provenance-badge.tsx` — LIVE/DELAYED/SECONDARY/STALE/UNAVAILABLE/UNKNOWN. Exports `resolveProvenanceState()` pure function. Priority: UNAVAILABLE > STALE > SECONDARY > DELAYED > LIVE > UNKNOWN.
- `components/ui/page-header.tsx` — H1 + breadcrumb + section label + actions. Use as the single `<h1>` on every route.

### New shared component (global)
- `global/src/components/ui/DataStatePanel.tsx` — same interface, Tailwind standard colors.

### Accessibility
- Scanner `layout.tsx`: skip-to-content link, `id="main-content"` + `role="main"` + `tabIndex={-1}` on main, `role="contentinfo"` on footer.
- Global `AppShell.tsx`: full accessibility overhaul — skip-to-content, `role="banner"`, `role="navigation" aria-label="..."`, `aria-current="page"` on active items, `id="main-content"` target, `role="contentinfo"` footer.

## What was NOT done (deferred)

- Route-by-route page improvements (Gate D) — pages still use ad-hoc heading patterns
- Full responsive testing at 6 viewports (Gate E)
- Full WCAG 2.2 AA audit per-route (Gate F)
- Bundle size optimization (Gate G)
- DataStatePanel is created but NOT yet wired into existing pages — pages still use their own loading/error UI

## Key design conventions established

- `DataStatePanel` is the canonical way to show data-loading, data-error, data-stale, and empty states.
- `ProvenanceBadge` is the canonical scanner source/freshness pill. Never render source labels ad-hoc.
- `PageHeader` is the canonical H1/breadcrumb pattern. Each page should have exactly one.
- Semantic tokens (`--positive`, `--negative`, `--warning`, `--info`, `--stale`) are now available in both apps across all themes. Use `text-positive`, `text-negative` etc. via `@theme inline`.
- `tabular-nums` class and `[data-tabular]` attribute are the correct way to render prices/quantities/timestamps in the scanner.

**Why:** Pack 6 established the foundation-level visual grammar. Future feature work should use these primitives rather than inventing new ad-hoc color choices or loading states.
