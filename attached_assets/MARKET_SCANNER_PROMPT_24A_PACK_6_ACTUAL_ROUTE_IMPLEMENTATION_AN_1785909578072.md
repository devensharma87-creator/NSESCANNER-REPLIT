# MARKET SCANNER — PROMPT 24A

## Fast-Track Pack 6: Actual Route Implementation and Visual-QA Closure

### Current verdict

`FAST_TRACK_PACK_6_NOT_ACCEPTED — FOUNDATION_CREATED_BUT_ROUTE_IMPLEMENTATION_AND_VISUAL_QA_INCOMPLETE`

The previous session produced useful UI foundations, but it did not complete Pack 6. Preserve the accepted foundation exactly where it is correct:

- corrected Global light/dark design tokens;
- Scanner semantic tokens across all five themes;
- shared `DataStatePanel` components;
- Scanner `ProvenanceBadge` and `resolveProvenanceState()`;
- Scanner `PageHeader`;
- skip-to-content, landmarks, active-navigation semantics and reduced-motion support;
- the 36 new primitive tests;
- accepted regression floors of `5,603` API-server tests and `1,011` Scanner tests.

The remaining work is not a new follow-up pack. Tasks `#173`, `#174` and `#175` describe work already required by Pack 6 and must be completed in this task. Do not defer route integration into new tasks.

---

## 1. Objective

Finish Pack 6 by applying the established design system and truthful data-state model to the actual navigable pages, then prove the implementation at real desktop and mobile viewports.

The result must be a coherent, professional trading interface in which:

- every active route has a consistent hierarchy and page header;
- loading, error, empty, unavailable, stale, partial, closed and ready states are distinct;
- provenance and freshness are visible wherever they materially affect trading interpretation;
- missing data is never presented as zero, positive, live or successful;
- responsive layouts remain usable without clipped controls, overlapping content or inaccessible tables;
- accessibility and keyboard behavior are demonstrated on production components;
- visual evidence covers real application pages, not only authentication screens.

This is UI/UX completion only. Do not reopen accepted signal formulas, trading gates, provider architecture, DB infrastructure or deployment work.

---

## 2. Anti-loop and scope rules

1. Do one focused preflight, produce one route matrix, implement once, and run one closing battery.
2. Do not start another broad audit or create another design system.
3. Reuse the new primitives. Create an additional primitive only if a concrete route cannot be implemented correctly with the existing set, and document the exact necessity.
4. Do not rewrite pages wholesale. Make bounded, reviewable route-level changes.
5. Do not create follow-up tasks for work listed in this prompt.
6. Do not touch strategy thresholds, scoring, vetoes, entries, stops, targets, position sizing, paper ledgers or trade lifecycle rules.
7. Do not activate Upstox or IndianAPI, alter provider precedence, remove Yahoo, or perform live provider calls.
8. Do not provision a DB, run DB-backed tests, change `DB_TEST_RUNTIME_AUTHORIZED`, clean operational rows, deploy, publish, push, pull or fetch.
9. Do not use fake success states or fabricate screenshots. If authenticated visual access is blocked, report the exact blocker; Pack 6 cannot be accepted on login-screen evidence.
10. Preserve last-good data during refetch errors. A stale warning may accompany usable cached data; it must not replace that data with a full-page error.

---

## 3. Step 1 — Read-only preflight and route matrix

Before editing, record:

- timestamp, HEAD, branch, upstream and working-tree state;
- exact changes already present from the Pack 6 foundation;
- every registered route in both Scanner and Global apps;
- route → production component → primary API hook → current state UI → provenance UI → responsive risk;
- which routes already use `PageHeader`, `DataStatePanel` or `ProvenanceBadge`;
- which routes still use ad-hoc or misleading state rendering;
- available local/test authentication or fixture mechanisms suitable for screenshots;
- the exact screenshots produced previously and confirmation that login-only screenshots do not satisfy this closure.

Classify every route as one of:

- `PACK_6_ROUTE_COMPLETE`
- `PACK_6_IMPLEMENTATION_REQUIRED`
- `ADMIN_INTERNAL`
- `RESERVED_FOR_LATER_ROADMAP`
- `BROKEN_OR_ORPHANED`

The matrix must appear in the evidence file and must cover every navigable route. Do not leave routes implicit.

---

## 4. Gate A — Apply the design system to actual routes

Integrate the existing shared components into production pages. Use judgment rather than mechanically replacing every element, but every active page must have truthful and consistent behavior.

### A1. Page hierarchy

- Use `PageHeader` on primary Scanner routes where the page lacks an equivalent accessible header.
- Ensure exactly one visible `<h1>` per primary route.
- Add a concise section label or breadcrumb only where it improves orientation.
- Preserve important route actions in the header without crowding small screens.
- Apply the equivalent hierarchy to Global routes using the established Global shell/components.

### A2. Actual state rendering

Use `DataStatePanel`, or a documented route-specific equivalent, for real route states:

- `LOADING`
- `ERROR`
- `EMPTY_VALID`
- `UNAVAILABLE`
- `CLOSED`

For `READY_STALE`, `READY_PARTIAL` and degraded states, retain usable data and show an inline warning or provenance state instead of hiding the page behind a generic panel.

Remove contradictory patterns such as:

- loading skeleton after a terminal first-fetch error;
- empty state described as warming when the response is valid and empty;
- unavailable provider described as loading;
- stale cached data labelled live;
- missing values rendered as `0`, green, bullish or successful;
- closed-market messaging inferred only from a client cache timestamp.

### A3. Provenance integration

- Use `ProvenanceBadge` on actual Scanner market-data surfaces where source/freshness materially affects interpretation.
- Reuse the canonical resolver; do not introduce competing provenance classifications.
- Preserve the Global app's canonical `DataProvenanceBadge` behavior.
- Provenance must be derived from response metadata, not React Query `dataUpdatedAt`.
- Do not label Yahoo data live. Do not present display-only fallbacks as trade-grade.

### A4. Route groups that must be inspected and closed

At minimum, cover every active route in these groups:

1. Dashboard and watchlist.
2. Stock detail, instrument detail and fundamentals.
3. Scanner, screener, sector and index detail.
4. Charting and candle views.
5. F&O signals, Options, option chain and OI Lab.
6. Swing analysis, swing signals and swing paper-trading views.
7. Portfolio analyser.
8. Equity and F&O paper trading, trade history and P&L views.
9. Backtest Lab.
10. Daily Analysis, reports, diagnostics and system-health pages.

For each route, record the exact component changes and the states now supported. If a group has no registered route, say so explicitly in the matrix.

---

## 5. Gate B — Responsive implementation on real pages

Test and fix actual pages at all six viewport sizes:

| Class | Viewport |
|---|---:|
| Small phone | `360 × 800` |
| Large phone | `390 × 844` |
| Tablet portrait | `768 × 1024` |
| Tablet landscape | `1024 × 768` |
| Laptop | `1366 × 768` |
| Desktop | `1440 × 900` |

At every viewport verify and, where needed, fix:

- navigation opening, closing, focus return and active-route visibility;
- header action wrapping and no clipped controls;
- cards with readable density and no accidental horizontal page scroll;
- wide tables using deliberate contained scrolling, sticky identifiers where valuable, and readable headers;
- charts retaining usable height, labels and controls;
- tabs remaining discoverable and keyboard operable;
- dialogs, drawers and popovers staying within the viewport;
- touch targets of practical size;
- numeric columns using tabular figures and stable alignment;
- footers and diagnostic banners not obscuring content.

Do not treat CSS token changes alone as responsive implementation.

---

## 6. Gate C — Accessibility closure on production components

Verify actual routes, not just primitives:

- skip links land on the correct main region;
- banner, navigation, main and content-info landmarks are unique and correctly labelled;
- the active navigation item exposes `aria-current="page"`;
- one logical `<h1>` exists per primary route, with ordered headings below it;
- loading and important status changes use appropriate live-region behavior without excessive announcements;
- icon-only controls have accessible names;
- form fields, selects and search controls have labels;
- tabs expose correct roles, selection state and keyboard navigation;
- tables have meaningful header associations;
- dialogs have a name, focus containment and focus restoration;
- visible keyboard focus is never suppressed;
- semantic positive/negative/warning/info/stale colors meet readable contrast in all supported themes;
- reduced-motion preference is respected.

Add executable tests for the load-bearing behavior. Avoid source-string-only assertions when a real component can be rendered.

---

## 7. Gate D — Authenticated visual QA and screenshot evidence

The previous login-screen screenshots are insufficient. Produce visual evidence from actual application pages.

### D1. Safe access

- Do not weaken production authentication.
- Use an already available safe owner session, or implement a strictly dev/test-only preview fixture harness.
- Any fixture harness must be excluded from or unreachable in production builds, contain no credentials, make no live provider calls and perform no DB writes.
- Add a load-bearing test proving the harness cannot activate in production.

### D2. Required page evidence

Capture representative ready and non-ready states for actual routes, including at least:

- Dashboard;
- Watchlist;
- stock/instrument detail;
- Scanner/Screener;
- Charting;
- F&O/Options;
- Option Chain or OI Lab;
- Swing analysis/signals;
- Portfolio;
- Paper Trading/history;
- Backtest Lab;
- Daily Analysis or Reports.

Capture desktop and phone images for every representative page. Add tablet evidence for routes with tables, charts or dense controls. Include at least one loading, error, empty, unavailable, stale/partial and market-closed example across the evidence set.

Store images under a clearly named Pack 6 evidence directory. Provide a screenshot inventory mapping file → route → viewport → state → data fixture/source.

### D3. Inspection record

For each representative route record:

- horizontal overflow result;
- clipped/overlapping controls result;
- heading and navigation result;
- provenance/state-label result;
- console errors and warnings;
- fix applied, if any.

The acceptance report must identify how many screenshots were inspected. A successful build is not a substitute for visual inspection.

---

## 8. Gate E — Performance and interaction hygiene

Record before/after production bundle sizes for Scanner and Global, including the largest entry chunks.

Verify:

- no new request or refetch loops;
- no unstable query keys;
- no repeated interval/listener registration after route remount;
- no excessive rerender loop introduced by state panels or provenance badges;
- no server-only module, provider credential or secret enters either browser bundle;
- heavy route code remains lazy-loaded where already designed;
- large tables and histories remain responsive at realistic row counts;
- skeleton/animation behavior respects reduced motion.

Do not add a new dependency unless the existing stack cannot satisfy a documented requirement. If a dependency is unavoidable, state its size and reason before using it.

---

## 9. Gate F — Load-bearing tests

Retain the existing 36 primitive tests and add route/component tests that prove the real integration.

Required coverage:

1. `PageHeader` or equivalent on representative actual routes with one `<h1>`.
2. Loading → ready transition.
3. First-fetch error with no cached data.
4. Refetch error with last-good data retained and marked stale.
5. Valid empty response distinct from error and loading.
6. Provider unavailable distinct from empty.
7. Partial data remains visible with an honest warning.
8. Market-closed state comes from the API contract.
9. Canonical source/as-of metadata drives provenance.
10. Missing numeric data remains unavailable rather than zero/positive.
11. Mobile navigation focus and close behavior.
12. Tab keyboard behavior on a dense data page.
13. Wide-table containment at narrow viewport.
14. Dev/test visual fixture harness is impossible to activate in production, if one is introduced.
15. No direct Upstox/IndianAPI/Yahoo transport import in client routes.
16. Pack 5 fundamentals UI, F&O safety and swing safety regressions remain green.

Prefer rendering the real route component with mocked API boundaries. Pure helper tests alone are not sufficient for this closure.

Do not add `.skip`, `.only`, arbitrary sleeps, retries that hide races or weakened assertions.

---

## 10. Gate G — Closing verification battery

Run once after implementation and report exact commands, file counts, pass/skip/fail counts and exit codes.

### Targeted

- all new Prompt 24A tests;
- the existing 36 Pack 6 primitive tests;
- Pack 5 provider/fundamentals tests;
- Pack 4 security/runtime tests;
- Pack 2 F&O lifecycle tests;
- Pack 3 swing lifecycle tests.

### Full tests

- API server full non-DB suite: floor `5,603`, plus all legitimate new tests;
- Scanner full suite: floor `1,011`, plus all legitimate new tests;
- Global full test suite: report the exact file and test count, not merely a typecheck;
- zero-DB tripwire and zero-live-provider proof.

### Typechecks

Run all five explicitly:

1. API server;
2. API Zod;
3. API client React;
4. Scanner;
5. Global.

### Production builds

Run all three explicitly:

1. API server;
2. Scanner;
3. Global.

### Integrity checks

- `git diff --check`;
- `.skip` / `.only` / retry / arbitrary-sleep audit;
- browser bundle secret/provider-credential sentinel scan;
- browser console audit on the screenshot routes;
- route manifest and navigation-link parity;
- `DB_TEST_RUNTIME_AUTHORIZED` unchanged;
- live broker execution hard block unchanged;
- no commit, push, pull, fetch, deploy or publish.

Do not claim “all builds” or “all typechecks” without listing every required target.

---

## 11. Evidence requirements

Update the existing file:

`artifacts/audit-evidence/FAST_TRACK_PACK_6_PROFESSIONAL_UI_UX_REFINEMENT.md`

It must contain:

1. final verdict;
2. starting and final Git state;
3. full route matrix;
4. actual route-level changed-file inventory;
5. data-state coverage by route;
6. responsive viewport matrix;
7. accessibility findings and fixes;
8. screenshot inventory with relative paths;
9. browser console results;
10. before/after bundle comparison;
11. targeted and full test totals;
12. all five typechecks;
13. all three builds;
14. zero-DB, zero-live-provider and secret-sentinel results;
15. SHA-256 of the evidence file;
16. confirmation that no manual commit, push or deployment occurred.

The final nonblank line must be exactly:

`END_FAST_TRACK_PACK_6_ACTUAL_ROUTE_IMPLEMENTATION_AND_VISUAL_QA_CLOSURE`

It must occur exactly once.

---

## 12. Acceptance rule

Return:

`ACCEPT_FAST_TRACK_PACK_6_PROFESSIONAL_UI_UX_REFINEMENT`

only if:

- the primitives are wired into actual production routes;
- every registered route is classified;
- representative authenticated pages are visually inspected at the required viewports;
- loading/error/empty/unavailable/stale/partial/closed states are truthful;
- responsive and accessibility gates pass;
- performance and bundle checks pass;
- all test, typecheck, build and integrity gates pass;
- evidence integrity is complete.

If any condition is not satisfied, return one exact blocker verdict and the smallest required next action. Do not create more roadmap tasks or claim Pack 6 completion.

---

## 13. Required final response format

Return only the final evidence record, not an execution diary:

1. Verdict
2. Route implementation summary
3. Data-state and provenance summary
4. Responsive viewport results
5. Accessibility results
6. Visual-QA screenshot inventory
7. Performance/bundle results
8. Tests, typechecks and builds
9. Git and integrity record
10. Evidence path, SHA-256 and terminator proof
11. Remaining roadmap status

After this prompt passes, return to the existing roadmap in order: provider activation and parity, canonical cross-tab data finalization, professional F&O strategy research/qualification, then the independent `FNO_PAPER_V2` and `SWING_PAPER_V2` cohorts. Do not begin those phases in this task.
