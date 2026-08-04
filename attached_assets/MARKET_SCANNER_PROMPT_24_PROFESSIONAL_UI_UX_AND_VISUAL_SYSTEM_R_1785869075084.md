# MARKET SCANNER — PROMPT 24

## Fast-Track Pack 6: Professional UI/UX and Visual-System Refinement

### Complete current website surfaces without reopening trading, provider, ledger or backend decision logic

## 1. Accepted baseline

Fast-Track Pack 5 is accepted and frozen with:

- API-server full non-DB suite: `5,603/5,603` passing;
- scanner suite: `975/975` passing;
- five clean TypeScript checks;
- API-server, scanner and global production builds passing;
- canonical Kite authority preserved;
- Upstox implemented as shadow-only;
- IndianAPI implemented for canonical reference/fundamentals consumption;
- provider activation still pending credentials and separately authorized live validation;
- production deployment unverified.

Do not reopen Pack 5 or any earlier functional pack unless a UI change causes a specific failing regression.

The stale Task `#172 — Fast-Track Pack 1` is obsolete. Do not approve, execute, recreate or use it as the work plan. This prompt is the only Pack 6 scope.

---

## 2. Objective

Transform the existing website into a cohesive, professional, information-dense trading terminal for personal use while preserving all accepted data-truth and trading-safety behavior.

The finished website must feel:

- reliable and calm rather than noisy;
- fast and responsive;
- visually consistent across the global and scanner applications;
- easy to scan during live markets;
- explicit about live, delayed, stale, partial, unavailable and error data;
- usable on desktop, tablet and mobile;
- accessible by keyboard and assistive technology;
- free of misleading colours, fabricated zeros, layout shifts and ambiguous actions.

This is an implementation pack, not a planning-only task. Start work after the scoped preflight. Do not stop after creating a task plan or ask “build here or in background.”

---

## 3. Non-negotiable constraints

1. Do not alter strategies, signals, confidence, weights, vetoes, entries, targets, stops, exits, lot sizes or capital rules.
2. Do not change F&O or swing lifecycle behavior.
3. Do not mutate ledgers, trade history or database records.
4. Do not change canonical provider routing or promote Upstox/IndianAPI.
5. Do not call providers directly from browser code.
6. Do not replace the existing charting library, routing framework, component framework or state/query libraries.
7. Do not redesign the backend merely to simplify styling.
8. Do not show missing values as zero, flat, positive, negative, live, closed or successful.
9. Do not use red/green as the only carrier of meaning.
10. Do not add decorative animation that distracts from market information.
11. Do not commit, push, pull, fetch, deploy or publish.
12. Do not make live provider calls or DB-backed tests.
13. Do not create another broad audit or new roadmap task.
14. Reuse and improve existing components before creating duplicates.

---

## 4. Step 1 — Read-only preflight and route inventory

Before editing:

1. Record timestamp, HEAD, branch, upstream/ahead-behind and working-tree state.
2. Record current scanner/global routes and their production components.
3. Record existing shared layout, navigation, typography, colour tokens, badges, state components, cards, tables, dialogs, tooltips and chart wrappers.
4. Identify current responsive breakpoints and mobile navigation behavior.
5. Identify existing component tests, browser/e2e tools and preview commands.
6. Capture baseline screenshots at these viewports where preview infrastructure permits:
   - 1440×900 desktop;
   - 1280×800 laptop;
   - 1024×768 tablet landscape;
   - 768×1024 tablet portrait;
   - 390×844 mobile;
   - 360×800 narrow mobile.
7. Inventory—not broadly re-audit—visible defects by route under:
   - hierarchy;
   - spacing/alignment;
   - density/readability;
   - responsiveness;
   - accessibility;
   - data-state clarity;
   - action clarity;
   - performance/layout shift.
8. Classify each issue as `PACK6_FIX`, `ALREADY_CORRECT`, or `OUT_OF_SCOPE_FUNCTIONAL`.

Do not use the old Task #172 defect list as current truth. Verify the current source and rendered UI.

---

## 5. Gate A — Unified design system

Create or consolidate a small token-driven visual system shared as far as the repository architecture safely permits.

### 5.1 Tokens

Define consistent semantic tokens for:

- application background;
- elevated surface/card;
- nested surface;
- border/divider;
- primary and secondary text;
- muted/metadata text;
- focus ring;
- selected/active state;
- information;
- positive;
- negative;
- warning;
- critical;
- stale/delayed;
- unavailable/disabled;
- chart grid and tooltip surfaces.

Support the existing theme behavior. Do not hardcode dozens of unrelated hex colours in page components.

### 5.2 Typography and numbers

- Use a consistent heading/body/label/metadata scale.
- Use tabular numerals for prices, percentages, quantities, P&L, OI and timestamps.
- Align numeric columns consistently.
- Preserve Indian-number and currency formatting where appropriate.
- Do not overuse uppercase text.
- Keep important market values visually prominent without oversized dashboard typography.

### 5.3 Spacing and surfaces

- Establish consistent page gutters, section spacing, card padding, border radius and control height.
- Remove unnecessary nested cards and double borders.
- Use subtle elevation; avoid excessive shadows and gradients.
- Keep dense trading tables compact but readable.

### 5.4 Reusable primitives

Consolidate or create only when needed:

- `PageHeader`;
- `SectionHeader`;
- `MetricCard`;
- `DataStatePanel`;
- `ProvenanceBadge`/existing data-source badge wrapper;
- `LastUpdated`/as-of display;
- `StatusPill`;
- responsive `DataTable` shell;
- empty/error/stale/partial-state panels;
- `RiskBanner`/guardrail notice;
- responsive tabs/segmented controls.

Do not create a second component when an existing one can be safely extended.

---

## 6. Gate B — Global shell and navigation

Refine the global and scanner application shells so they feel like one product.

### Required outcomes

1. Consistent product name, header height, page width and visual language.
2. Clear primary navigation grouped by workflow:
   - Market Overview;
   - Research/Scanner;
   - F&O;
   - Swing;
   - Portfolio/Paper Trading;
   - Reports/Analysis;
   - System/Admin where authorized.
3. Active route is unmistakable and keyboard-accessible.
4. Mobile navigation does not overflow, cover content or trap focus.
5. Global provider/session/system health appears once in a concise status area—not repeated noisily across every card.
6. Critical blockers remain prominent; routine healthy statuses remain quiet.
7. Breadcrumbs or contextual back navigation exist on detail pages.
8. Owner/admin routes are not presented to unauthorized users.
9. No broken, duplicate, orphaned or misleading navigation links.
10. Page transitions avoid unnecessary full-layout jumps.

---

## 7. Gate C — Honest data-state experience

Preserve the accepted semantic state model and make it visually consistent:

- `LOADING`;
- `READY_LIVE`;
- `READY_DELAYED`;
- `READY_STALE`;
- `READY_PARTIAL`;
- `EMPTY_VALID`;
- `DEGRADED`;
- `UNAVAILABLE`;
- `ERROR`;
- `CLOSED`.

### Required rules

1. Loading uses stable skeleton dimensions to prevent layout shifts.
2. Initial errors show a clear retry action.
3. Refetch errors retain usable cached data with a stale/degraded notice.
4. Empty valid data is not called an error or “warming up” indefinitely.
5. Unavailable capability differs from missing credentials, market closed and upstream error.
6. Market closed is shown only from authoritative market-status data.
7. Delayed/stale data displays source and as-of time.
8. Partial data identifies what is missing without hiding valid sections.
9. Null values render as `—`/unavailable, never zero.
10. Positive/negative colours are applied only to finite, semantically comparable values.
11. Every retry button has accessible text and a bounded action.
12. State panels use consistent wording across applications.

---

## 8. Gate D — Route-by-route professional refinement

Inspect and refine every currently registered navigable route. Do not revive orphaned pages.

### 8.1 Dashboard / Market Overview

- Improve information hierarchy: market status → indices → breadth → watchlist/alerts → supporting details.
- Reduce repeated status cards.
- Make live/delayed/stale provenance visible but unobtrusive.
- Ensure index movement, change and direction are neutral when missing.
- Prevent dense cards from collapsing badly on smaller screens.

### 8.2 Watchlist

- Compact, sortable, responsive presentation.
- Clear symbol/name, price, change, source and as-of hierarchy.
- Sticky headers where useful.
- Mobile view may use controlled horizontal scrolling or cards without losing essential columns.
- Empty/error/loading states remain distinct.

### 8.3 Stock/Instrument Detail and Fundamentals

- Create a coherent summary header for symbol, exchange, price, change, market state, source and as-of.
- Organize Overview, Chart, Fundamentals and other current sections with responsive tabs.
- FundamentalsCard must use consistent metric layout, clear units and `—` for nulls.
- IndianAPI fundamentals must never visually replace Kite live price.
- Long company descriptions, tables and news items must not break the layout.

### 8.4 Scanner, Screener, Sector and Index detail

- Improve filter discoverability and active-filter summary.
- Keep result counts, scan time, coverage and source status visible.
- Make partial scans and unavailable rows clear.
- Preserve table density and keyboard usability.
- Avoid implying ranking certainty when data is partial/stale.

### 8.5 Charts

- Improve chart container sizing and responsive behavior.
- Ensure controls do not wrap unpredictably.
- Use readable axes, grid, legends and tooltips.
- Show source/as-of/interval/range clearly.
- Loading/error/empty/invalid-OHLC states occupy stable space.
- Do not change chart calculations or library.

### 8.6 F&O Options cockpit

- Prioritize market status, data trust, setup availability, signal tier and risk blockers.
- Separate actionable signals, watchlist setups and information-only items visually.
- Keep signal cards dense but scannable.
- Entry, target, stop, confidence, drivers and vetoes must have consistent hierarchy.
- Missing values remain unavailable.
- Market-closed, no-signal and data-unavailable states remain distinct.
- Do not change F&O logic.

### 8.7 Option Chain and OI Lab

- Improve strike-table readability, ATM emphasis, CE/PE separation and sticky headers.
- Use accessible non-colour cues for OI build-up/unwinding.
- Make expiry, spot, source and as-of prominent.
- Handle wide tables on mobile without clipping or unreadable compression.
- Preserve missing OI/IV/premium as null/unavailable.

### 8.8 Swing workflow

- Clarify staged → review → approved/dry-run → expired/rejected/blocked lifecycle.
- Make owner-required actions obvious but not alarming when no action is needed.
- Distinguish market data, risk gate and execution status.
- Preserve all swing safety gates and broker blocks.

### 8.9 Portfolio Analyser

- Improve allocation, returns, holding status and unpriced-position disclosure.
- Clearly separate current value, invested value, realized/unrealized P&L and unavailable totals.
- Charts and tables must share consistent legends and colours.
- Responsive layouts must not hide excluded/unpriced holdings.

### 8.10 Paper Trading and Trade History

- Distinguish open, closed, information-only, rejected and modeled outcomes.
- Make gross P&L, charges and net P&L visually separate.
- Keep lifecycle timeline and provenance understandable.
- Missing P&L remains unavailable.
- Do not mutate records or change calculations.

### 8.11 Backtest Lab

- Improve parameter form hierarchy and validation messages.
- Separate running, zero-trade, failed and completed states.
- Present assumptions, date range, costs, gross/net results and limitations clearly.
- Avoid presenting historical simulation as guaranteed performance.

### 8.12 Daily Analysis, Reports and Diagnostics

- Improve section hierarchy and report-date prominence.
- Label previous-day/partial reports clearly.
- Use collapsible technical detail where appropriate without hiding blockers.
- Owner diagnostics should prioritize failures, impact and action; routine internals can remain secondary.
- Avoid repeated Telegram-style alert wording inside the website.

---

## 9. Gate E — Responsive behavior

Test each active route at the six baseline viewports.

### Required behavior

- no horizontal page overflow except intentionally scrollable data tables/charts;
- no clipped buttons, badges, dropdowns, dialogs or tooltips;
- touch targets approximately 44×44 px where practical;
- filters and actions remain reachable;
- sticky elements do not cover content;
- tables retain essential identity and numeric columns;
- modals/sheets fit viewport height and scroll internally;
- charts resize without distortion;
- mobile keyboard does not make forms unusable;
- orientation changes remain stable;
- long symbols, error messages and company names wrap safely.

Do not solve responsiveness by hiding critical data without an accessible alternative.

---

## 10. Gate F — Accessibility

Target WCAG 2.2 AA for current routes.

### Required checks

1. Semantic landmarks and heading order.
2. Keyboard navigation and visible focus.
3. Skip-to-content where appropriate.
4. Labels/descriptions for controls.
5. Accessible names for icon-only buttons.
6. Table headers and relationships.
7. Dialog focus trap, initial focus and escape behavior.
8. Tabs with correct roles and keyboard behavior.
9. Live regions only for meaningful state changes—not streaming tick noise.
10. Minimum contrast for text, controls and focus indicators.
11. Red/green meaning supplemented by icons/text/sign.
12. Reduced-motion preference respected.
13. Tooltips are not the only source of essential information.
14. Screen-reader output for unavailable, stale and partial states is unambiguous.

Use automated accessibility checks if existing infrastructure supports them, plus keyboard/manual verification of critical workflows.

---

## 11. Gate G — Performance and stability

Improve UI efficiency without changing data semantics.

### Required checks

- eliminate avoidable duplicate queries and render loops;
- retain complete React Query keys;
- avoid polling storms and refetch-on-every-render;
- memoize only measurable expensive transforms;
- virtualize very large tables only if an existing lightweight mechanism is available and behavior remains testable;
- lazy-load heavy route-level modules where safe;
- avoid importing server-only/provider modules into client bundles;
- keep skeletons/layout dimensions stable;
- prevent charts from rebuilding for unrelated state changes;
- report scanner/global bundle sizes before and after;
- investigate material regressions rather than hiding them.

Do not introduce a new major dependency for a cosmetic improvement without explicit justification.

---

## 12. Gate H — Real visual and interaction QA

Automated source assertions are not sufficient.

### Required proof

1. Start the actual local preview using the repository’s supported command.
2. Exercise every registered route with safe mocked/local data or existing non-live fixtures.
3. Capture after screenshots at the baseline viewports for representative routes:
   - Dashboard;
   - Watchlist;
   - Stock Detail/Fundamentals;
   - Scanner results;
   - Chart;
   - F&O cockpit;
   - Option Chain/OI;
   - Swing;
   - Portfolio;
   - Paper Trading;
   - Backtest;
   - Daily Analysis/Reports.
4. Record before/after comparisons for hierarchy, readability, overflow and state clarity.
5. Test keyboard navigation through navigation, filters, tabs, tables, dialogs and retry actions.
6. Verify no browser console errors or React key/hydration warnings.
7. Verify dark/light theme if both are supported.

If preview infrastructure is technically blocked, report the exact blocker. Do not fabricate visual verification.

---

## 13. Gate I — Load-bearing tests

Add focused tests that validate behavior, not CSS class strings alone.

At minimum cover:

- shared state panels for all semantic states;
- null value and direction neutrality;
- stale cached data retained with label;
- provenance/as-of display;
- navigation active states and unauthorized-route visibility;
- responsive navigation open/close and focus behavior;
- actual route components rendering without crash;
- FundamentalsCard integration and live-price separation;
- Options actionable/info-only/watchlist distinctions;
- swing lifecycle status distinctions;
- portfolio unavailable totals;
- paper-trade gross/charges/net presentation;
- Backtest zero-trade vs failure;
- report date/partial state;
- accessible labels/roles for critical controls;
- reduced motion or animation-free critical workflows;
- no direct provider URLs/imports in client sources;
- no secret/provider sentinel in builds.

Use real components and production hooks with mocked transports. Avoid large snapshot-only tests that approve accidental regressions.

---

## 14. Closing battery

After targeted tests and visual QA pass, run once:

1. New Pack 6 targeted tests with exact per-file totals.
2. Existing Pack 5 route/component/provider tests.
3. F&O lifecycle tests.
4. Swing lifecycle tests.
5. Pack 4 security/runtime/config tests.
6. API-server full non-DB suite: floor `5,603` plus legitimate new tests.
7. Scanner full suite: floor `975` plus legitimate new tests.
8. Global app full test suite with exact count.
9. Five TypeScript checks:
   - API server;
   - API Zod;
   - API client React;
   - scanner;
   - global.
10. Three production builds:
   - API server;
   - scanner;
   - global.
11. `git diff --check`.
12. New `.skip`, `.only`, retries, arbitrary sleeps and weakened-assertion audit.
13. Browser console error audit.
14. Client-bundle credential/server-only import scan.
15. Zero live-provider calls and zero DB connections during normal tests.
16. Confirm `DB_TEST_RUNTIME_AUTHORIZED`, broker blocks and live cash execution remain unchanged.

Fix regressions before reporting. No regression exceptions.

---

## 15. Evidence and deliverables

Create:

`artifacts/audit-evidence/FAST_TRACK_PACK_6_PROFESSIONAL_UI_UX_REFINEMENT.md`

Include:

1. final verdict;
2. route inventory and current classification;
3. exact changed-file inventory;
4. design-token and shared-component changes;
5. route-by-route changes;
6. semantic state preservation;
7. responsive viewport matrix;
8. accessibility results;
9. performance/bundle comparison;
10. before/after screenshot inventory and paths;
11. targeted/full test totals;
12. five typechecks and three builds;
13. integrity/security tripwires;
14. Git state and confirmation of no commit/push/deploy;
15. remaining owner actions;
16. production status.

Store screenshots under a dedicated evidence directory such as:

`artifacts/audit-evidence/pack6-ui-screenshots/`

Do not store credentials or personal account data in screenshots. Redact or use safe fixtures.

Final nonblank line:

`END_FAST_TRACK_PACK_6_PROFESSIONAL_UI_UX_REFINEMENT`

---

## 16. Final verdict

Use only if all gates pass:

`ACCEPT_FAST_TRACK_PACK_6_PROFESSIONAL_UI_UX_REFINEMENT`

Otherwise:

`FAST_TRACK_PACK_6_NOT_ACCEPTED — <EXACT_REMAINING_BLOCKER>`

---

## 17. Required final response

Return a concise completion record—not an execution diary:

1. Verdict
2. Visual-system changes
3. Route-by-route completion matrix
4. Responsive and accessibility results
5. Data-state honesty confirmation
6. Visual QA/screenshot results
7. Performance/bundle results
8. Exact test/typecheck/build totals
9. Integrity and Git record
10. Remaining owner actions
11. Production status

Do not create or revive Task #172. Do not create another roadmap task. After Pack 6 acceptance, wait for the evidence-based Yahoo-retirement prompt.

`PRODUCTION_DEPLOYMENT_STATUS_UNVERIFIED`
