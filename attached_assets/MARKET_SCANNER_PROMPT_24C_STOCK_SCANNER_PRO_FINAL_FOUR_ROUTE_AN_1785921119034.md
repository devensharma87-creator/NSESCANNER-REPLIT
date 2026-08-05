# STOCK SCANNER PRO — PROMPT 24C

## Pack 6 Final Four-Route and Complete Route-Matrix Closure

### Current verdict

`PACK_6_NOT_ACCEPTED — PROJECT_IDENTITY_FIXED_BUT_ROUTE_AND_VISUAL_COVERAGE_INCOMPLETE`

Project identity is now correctly confirmed:

`PROJECT_IDENTITY_CONFIRMED — STOCK_SCANNER_PRO`

Global Multi Asset Scanner is frozen and excluded. Preserve that boundary. Do not inspect, edit, test, build, screenshot, revert or count any `artifacts/global` file in this task.

The previous response corrected project scope, but its own matrix shows four required Stock Scanner Pro visual routes still missing and 25 of 37 registered routes grouped together instead of being individually classified.

This is the final narrow Pack 6 closure. Do not redesign the website, create another pack or repeat completed work.

---

## 1. Exact remaining blockers

Close only these blockers:

1. The production registry contains `37` Stock Scanner Pro routes, but only `12` were itemized. “Remaining 25 routes — existing” is not a route matrix.
2. Required visual evidence is explicitly absent for:
   - stock or instrument detail (`/stock/:symbol` or the actual registered equivalent);
   - `/charting`;
   - `/portfolio-analyser`;
   - `/daily-analysis` or the registered reports route.
3. The evidence does not provide a complete state matrix proving ready, loading, error, empty, unavailable, stale, partial and closed behavior across real Stock Scanner Pro pages.
4. The final report does not provide route-level accessibility results, exact browser-console warning/error counts, route/navigation parity or production fixture/bundle sentinel results.

Do not reopen routes already proved unless a regression appears.

---

## 2. Mandatory preflight

Read-only checks only:

- confirm HEAD and branch;
- confirm the active app is `@workspace/scanner` under Stock Scanner Pro;
- confirm `artifacts/global` remains unchanged and frozen;
- record the current `37` registered routes directly from `artifacts/scanner/src/App.tsx`;
- verify the four missing routes above exist and identify their production components/API hooks.

If project identity changes or a Global file changes, stop with:

`STOP — PROJECT_SCOPE_VIOLATION`

---

## 3. Gate A — Itemize all 37 Stock Scanner Pro routes

Produce one row for every registered route. No grouped “remaining routes” row is permitted.

Required columns:

| Field | Required |
|---|---|
| Route | Exact registered path |
| Component | Production component |
| Navigation | Linked, deep-link only, redirect or internal |
| Access | Public, authenticated, owner-only or subscriber-gated |
| Data boundary | Primary API hook/endpoint or N/A |
| UI hierarchy | `PageHeader` or justified specialized equivalent |
| State handling | Ready/loading/error/empty/unavailable/stale/partial/closed as applicable |
| Provenance | Component/metadata or honestly N/A |
| Responsive risk | Table/chart/tabs/dialog/form/none |
| Classification | Complete, admin/internal, legal/static, redirect, reserved, broken/orphaned |
| Pack 6 action | Changed, visually proved, test proved or no change required |

Requirements:

- all `37` routes must appear exactly once;
- verify navigation links point to registered routes;
- classify parameterized routes such as stock/index details explicitly;
- identify redirects and aliases rather than counting them as independent completed pages;
- fix only a confirmed broken/orphaned route or navigation link.

---

## 4. Gate B — Complete the four missing visual routes

Use the existing Stock Scanner Pro development fixture system. Do not use live providers, operational credentials or DB writes.

### B1. Stock/Instrument Detail

Capture a contract-valid symbol route with:

- quote and change direction;
- canonical source/provenance and `asOf`;
- chart or relevant detail sections;
- null-value behavior showing unavailable rather than zero/green;
- phone `390×844`;
- tablet `768×1024`;
- desktop `1440×900`.

### B2. Charting

Capture `/charting` with:

- valid ordered OHLC candles;
- chart controls and interval/range selector;
- canonical source/as-of display;
- no future or duplicate last candle;
- phone `390×844`;
- tablet portrait `768×1024`;
- tablet landscape `1024×768`;
- desktop `1440×900`.

### B3. Portfolio Analyser

Capture `/portfolio-analyser` with:

- at least one priced holding;
- at least one unavailable/unpriced holding;
- honest excluded/unpriced disclosure;
- no missing price represented as zero P&L;
- contained table scrolling;
- phone `390×844`;
- tablet `768×1024`;
- desktop `1440×900`.

### B4. Daily Analysis or Reports

Capture `/daily-analysis` or the canonical report route with:

- IST report date;
- ready or partial report state;
- prior-day status clearly labelled when applicable;
- unavailable section visibly distinguished from successful empty content;
- phone `390×844`;
- tablet `768×1024`;
- desktop `1440×900`.

For every screenshot record route, viewport, fixture state, provenance, overflow, clipping and exact console warning/error count.

Login pages and API-`401`-only screens remain invalid.

---

## 5. Gate C — Complete Stock Scanner Pro state coverage

Create one evidence matrix mapping each required state to an actual route screenshot and executable test:

| Required state |
|---|
| `READY_LIVE` |
| `READY_DELAYED` where legitimately supported |
| `LOADING` |
| `ERROR` |
| `EMPTY_VALID` |
| `UNAVAILABLE` |
| `READY_STALE` |
| `READY_PARTIAL` |
| `CLOSED` |

Rules:

- source and freshness metadata must match the displayed label;
- Yahoo/display fallback must never be labelled live or trade-grade;
- stale/partial states retain last-good data where available;
- missing numeric fields remain null/unavailable;
- market closed must derive from the API market-status contract;
- use the minimum additional screenshots needed; do not repeat all 37 routes.

---

## 6. Gate D — Final accessibility, console and performance proof

For the four missing visual routes verify:

- one logical `<h1>`;
- ordered headings;
- labelled controls;
- keyboard-operable tabs/selectors;
- visible focus;
- table/header semantics;
- contained horizontal scrolling;
- responsive chart/table height;
- no clipped controls;
- reduced-motion compatibility.

Report browser-console results separately:

- unhandled exceptions;
- React errors;
- failed fixture requests;
- accessibility warnings;
- other warnings.

Zero unhandled exceptions alone is not a complete console audit.

Report Stock Scanner Pro bundle proof only:

- current Scanner JS/CSS total;
- largest entry/lazy chunks;
- comparison with the already recorded `2,854 KB JS / 256 KB CSS` result;
- proof fixture bypass/data is unavailable or inert in production;
- proof that no provider key, session secret, owner credential or fixture sentinel appears in client output.

---

## 7. Gate E — Minimal load-bearing tests

Add only tests required for the remaining proof:

1. Stock/Instrument Detail canonical provenance and null honesty.
2. Charting ordered OHLC data and complete query key.
3. Portfolio partial-pricing disclosure.
4. Daily Analysis IST date and partial-section behavior.
5. Every fixture payload used for these routes passes its production Zod contract where a contract exists.
6. Four-route render smoke: no throw with ready fixtures.
7. Four-route error/unavailable behavior where applicable.
8. Fixture bypass cannot activate in production.
9. Route registry and navigation parity covers all 37 routes.
10. No DB, live provider, Telegram or broker invocation.

Do not add `.skip`, `.only`, arbitrary sleeps or retries that hide failures.

---

## 8. Gate F — Closing battery

Run once after the narrow closure:

### Tests

- new Prompt 24C tests;
- existing Prompt 24/24A/24B tests;
- Stock Scanner Pro Scanner full suite: floor `1,053` plus new tests;
- API server full non-DB suite: floor `5,603` plus legitimate new tests;
- relevant Pack 2 F&O, Pack 3 swing, Pack 4 security and Pack 5 provider/fundamentals tests;
- zero-DB and zero-live-provider tripwires.

### Four typechecks

1. Scanner
2. API server
3. API Zod
4. API client React

### Two builds

1. Scanner production build
2. API-server production build

### Integrity

- `git diff --check`;
- skip/only/retry/sleep audit;
- route/navigation parity;
- client bundle secret and fixture sentinel scan;
- `DB_TEST_RUNTIME_AUTHORIZED` unchanged;
- broker execution hard block unchanged;
- `artifacts/global` unchanged;
- no commit, push, pull, fetch, deploy or publish.

---

## 9. Evidence closure

Append one final Stock Scanner Pro-only section to:

`artifacts/audit-evidence/FAST_TRACK_PACK_6_PROFESSIONAL_UI_UX_REFINEMENT.md`

Include:

1. project identity;
2. all 37 itemized route rows;
3. four-route screenshot inventory;
4. complete state matrix;
5. accessibility and console results;
6. bundle and production-fixture sentinel results;
7. test/typecheck/build results;
8. Git/integrity record;
9. Global freeze confirmation;
10. evidence SHA-256.

The final nonblank line must be exactly:

`END_FAST_TRACK_PACK_6_STOCK_SCANNER_PRO_FINAL_ACCEPTANCE_CLOSURE`

It must occur exactly once.

---

## 10. Acceptance and final response

Return:

`ACCEPT_FAST_TRACK_PACK_6_PROFESSIONAL_UI_UX_REFINEMENT`

only after every gate above passes.

Return only:

1. Verdict
2. 37-route classification summary
3. Four missing route visual results
4. Complete data-state matrix
5. Accessibility, console and bundle results
6. Tests, four typechecks and two builds
7. Git/integrity and Global-freeze confirmation
8. Evidence path, SHA-256 and terminator proof
9. Remaining Stock Scanner Pro roadmap status

Do not return an execution diary. Do not create another task or pack. After acceptance, stop; provider activation/parity remains the next roadmap phase.
