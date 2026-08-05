# MARKET SCANNER — PROMPT 24B

## Pack 6 Final Route-Coverage and Visual-Evidence Closure

### Mandatory verdict on the previous response

`FAST_TRACK_PACK_6_NOT_ACCEPTED — LIMITED_ROUTE_WIRING_AND_INCOMPLETE_VISUAL_EVIDENCE`

The previous response delivered useful incremental work, but it did not satisfy Prompt 24A. Preserve the work that is correct; do not redesign it:

- Global and Scanner token corrections;
- `DataStatePanel`, `ProvenanceBadge`, `PageHeader` and their primitive tests;
- shell accessibility improvements;
- the strictly development-only preview bypass, provided its production exclusion remains load-bearing and no secret is involved;
- the four reported route integrations;
- current reported regression floors: API server `5,603`, Scanner `1,032`.

This prompt closes only the unfulfilled Pack 6 gates. It is not a new roadmap phase.

---

## 1. Why the previous submission is not accepted

The response itself proves the following gaps:

1. Only four bounded route changes were reported:
   - Scanner Watchlist error state;
   - Global Screener error state;
   - Global Instrument Detail provenance;
   - Global Instrument Detail candle error state.
2. No complete registered-route matrix was returned.
3. `PageHeader` was not shown as integrated into production routes.
4. Nine screenshots do not cover the required application surface.
5. Only `1440×900` and `390×844` were reported; Prompt 24A required six viewports.
6. The Scanner screenshots reportedly received API `401` responses. Passing a UI login wall while production route data calls remain unauthorized is not authenticated end-to-end page proof.
7. Visual states covered only loading, empty and unavailable. Error, stale, partial, ready/live or ready/delayed, and closed-state evidence is missing.
8. No route-by-route accessibility record was reported.
9. No browser-console error/warning record was reported.
10. No before/after bundle-size comparison was reported.
11. No exact Global full-suite file/test count was reported.
12. No complete actual-route integration test inventory was reported; `21` tests cannot by assertion alone substitute for the missing route and viewport evidence.

Do not dispute these points with prose. Close them with executable and visual evidence.

---

## 2. Anti-loop execution rules

1. Do not perform another broad design audit.
2. Do not create new roadmap tasks, packs, primitives, themes or provider work.
3. Do not revisit accepted backend, F&O, swing, ledger, strategy or DB logic.
4. Do not activate providers, call live broker/provider services or use operational credentials.
5. Do not deploy, publish, push, pull, fetch or create a manual commit.
6. Implement only the missing Pack 6 route wiring and proof described below.
7. Use one preflight, one implementation pass and one closing battery.
8. If a route already meets the requirement, record executable/visual proof and leave it unchanged.
9. Do not accept login pages, `401`-only pages, source-string assertions or successful builds as substitutes for route behavior.

---

## 3. Gate 1 — Complete registered-route matrix

Enumerate every route registered in both applications directly from the production route registries.

For every route record:

| Field | Required value |
|---|---|
| App | Scanner or Global |
| Route | Exact registered path |
| Component | Production page component |
| Data boundary | API hook/query used |
| Header | Existing equivalent or `PageHeader` |
| States | Loading, error, empty, unavailable, stale/partial, closed, ready as applicable |
| Provenance | Component/metadata used or honestly N/A |
| Responsive risk | Table, chart, tabs, dialog, dense controls, none |
| Status | Complete, fixed in this task, admin/internal, reserved, broken/orphaned |

No registered route may be omitted. Check navigation links against the route registry and fix any broken or orphaned link.

---

## 4. Gate 2 — Finish actual route integration

Apply the existing shared system to every route that requires it. Do not mechanically replace valid specialized UI.

### 4.1 Required route groups

Close all registered routes belonging to these groups:

1. Dashboard and Watchlist.
2. Stock/Instrument/Fundamentals detail.
3. Scanner, Screener, Sector and Index detail.
4. Charting/candles.
5. F&O Signals, Options, Option Chain and OI Lab.
6. Swing analysis/signals/staging/paper trading.
7. Portfolio Analyser.
8. Equity/F&O Paper Trading, history and P&L.
9. Backtest Lab.
10. Daily Analysis, Reports, Diagnostics and System Health.

If one of these has no production route, record `NO_REGISTERED_ROUTE`; do not invent a page.

### 4.2 Integration requirements

- Ensure one visible, logical `<h1>` per primary route.
- Use `PageHeader` where the route lacks an equivalent accessible hierarchy.
- Use `DataStatePanel` or a justified existing equivalent for terminal loading/error/empty/unavailable/closed states.
- Preserve last-good data during refetch failure; show stale/partial status inline.
- Use canonical response metadata for provenance and `asOf`, never React Query update time.
- Keep null values unavailable; never render them as zero, bullish, green, successful or live.
- Ensure table/chart/tab/dialog layouts use the established semantic tokens and numeric alignment.
- Do not change trading calculations, admission gates or lifecycle behavior.

Return an exact route-level changed-file list. “Targeted changes” without full route classification is insufficient.

---

## 5. Gate 3 — Deterministic visual fixture environment

The existing dev-only authentication bypass may be retained only if all conditions below pass:

1. It is gated by both development mode and an explicit preview flag.
2. It is unreachable in production builds.
3. It contains no owner cookie, password, token or provider credential.
4. A production-build sentinel test proves the bypass branch/flag cannot enable access.
5. The preview uses deterministic, contract-valid API fixtures for route screenshots instead of uncontrolled API `401` responses.
6. Fixtures exercise the real production route components and API response contracts.
7. No DB write, provider call, scheduler, Telegram call or broker call occurs.

Create only the smallest dev/test fixture adapter needed. It must support these display states across representative routes:

- `READY_LIVE`
- `READY_DELAYED` where legitimately applicable
- `LOADING`
- `ERROR`
- `EMPTY_VALID`
- `UNAVAILABLE`
- `READY_STALE`
- `READY_PARTIAL`
- `CLOSED`

Do not fake a live label without contract-valid source and freshness metadata.

---

## 6. Gate 4 — Six-viewport visual QA on real pages

Inspect actual page content at all required viewports:

| Viewport | Required |
|---|---:|
| Small phone | `360×800` |
| Large phone | `390×844` |
| Tablet portrait | `768×1024` |
| Tablet landscape | `1024×768` |
| Laptop | `1366×768` |
| Desktop | `1440×900` |

### Minimum representative page set

Capture and inspect, at minimum:

1. Dashboard
2. Watchlist
3. Stock or Instrument Detail
4. Scanner or Screener
5. Charting
6. F&O Signals/Options
7. Option Chain or OI Lab
8. Swing analysis/signals
9. Portfolio
10. Paper Trading/history
11. Backtest Lab
12. Daily Analysis or Reports

Every representative page requires phone and desktop evidence. Dense tables/charts/forms additionally require tablet portrait and landscape evidence. Across the complete set, every one of the six viewports must be exercised multiple times.

Login screens and pages whose only meaningful result is API `401` do not count.

For each screenshot record:

- file path;
- route;
- application;
- viewport;
- fixture/data state;
- provenance state;
- horizontal overflow result;
- clipped/overlapping control result;
- navigation/header result;
- console error/warning count;
- any fix made after inspection.

Store screenshots under a dedicated Pack 6 evidence directory.

---

## 7. Gate 5 — Responsive and accessibility correction

Use the visual findings to correct actual pages. Prove:

- no document-level horizontal overflow;
- wide tables scroll within a labelled container;
- charts retain usable height and controls;
- header actions wrap without covering titles;
- tabs remain visible and keyboard operable;
- dialogs/drawers remain inside the viewport and restore focus;
- mobile navigation opens/closes by keyboard and restores focus;
- icon-only actions have accessible names;
- forms and search controls have labels;
- headings remain ordered;
- landmarks are unique;
- active navigation has `aria-current="page"`;
- live regions announce material state changes without noise;
- focus styles are visible in all supported themes;
- semantic colors remain readable in light/dark and Scanner themes;
- reduced-motion behavior remains effective.

Add component/route tests for the load-bearing interactions. Do not rely solely on source scans.

---

## 8. Gate 6 — Performance and bundle proof

Report exact before/after production bundle results for Scanner and Global:

- total JS/CSS bytes;
- gzip/brotli sizes if the build reports them;
- largest entry and lazy chunks;
- any chunk whose size materially increased and why.

Verify through tests or instrumentation:

- no refetch/render loop from route state components;
- stable query keys;
- no duplicate interval/listener registration on remount;
- fixture code is absent or inert in production;
- no server-only module or provider secret in client output;
- no direct provider SDK/transport import in pages;
- no material interaction regression with realistic table/history row counts.

---

## 9. Gate 7 — Required executable tests

Retain all existing Pack 6 tests and add actual route/component coverage for:

1. representative route header and one-`h1` behavior;
2. loading → ready;
3. first-fetch error;
4. cached-data refetch error retaining data with stale warning;
5. valid empty state;
6. unavailable-provider state;
7. partial response retaining usable sections;
8. market-closed response from API metadata;
9. canonical provenance/as-of rendering;
10. null numeric value honesty;
11. mobile navigation keyboard/focus behavior;
12. dense-page tab keyboard behavior;
13. narrow-viewport table containment;
14. fixture bypass impossible in production;
15. fixture payloads pass production Zod contracts;
16. no live provider, DB, Telegram or broker calls;
17. Pack 5 fundamentals integration remains correct;
18. F&O and swing safety baselines remain unchanged.

The existing 21 Prompt 24A tests may be retained, but they do not by themselves close this gate.

---

## 10. Gate 8 — Closing battery

Run once after all corrections and provide exact commands and results.

### Tests

- all Prompt 24/24A/24B targeted tests;
- Pack 5 provider/fundamentals tests;
- Pack 4 runtime/security tests;
- Pack 2 F&O lifecycle tests;
- Pack 3 swing lifecycle tests;
- API server full non-DB suite: floor `5,603` plus legitimate additions;
- Scanner full suite: floor `1,032` plus legitimate additions;
- Global full test suite with exact file/test counts;
- zero-DB and zero-live-provider tripwire.

### Typechecks — all five

1. API server
2. API Zod
3. API client React
4. Scanner
5. Global

### Production builds — all three

1. API server
2. Scanner
3. Global

### Integrity

- `git diff --check`;
- skip/only/retry/arbitrary-sleep audit;
- route/navigation parity;
- client secret/provider sentinel scan;
- browser-console audit for screenshot routes;
- `DB_TEST_RUNTIME_AUTHORIZED` unchanged;
- broker execution hard block unchanged;
- no commit, push, pull, fetch, deploy or publish.

---

## 11. Evidence closure

Update:

`artifacts/audit-evidence/FAST_TRACK_PACK_6_PROFESSIONAL_UI_UX_REFINEMENT.md`

Append one final correction section containing:

1. final verdict;
2. full route matrix;
3. exact changed-file inventory;
4. per-route data-state/provenance coverage;
5. six-viewport matrix;
6. screenshot inventory;
7. accessibility results;
8. console audit;
9. before/after bundle results;
10. targeted/full test results;
11. all five typechecks;
12. all three builds;
13. Git/integrity record;
14. evidence SHA-256.

The final nonblank line must be exactly:

`END_FAST_TRACK_PACK_6_FINAL_ROUTE_COVERAGE_AND_VISUAL_EVIDENCE_CLOSURE`

It must occur exactly once.

---

## 12. Final acceptance rule

Return:

`ACCEPT_FAST_TRACK_PACK_6_PROFESSIONAL_UI_UX_REFINEMENT`

only when every gate above is proved.

Otherwise return one exact blocker verdict with the smallest unresolved action. Do not create tasks `#176+`, another UI pack or another audit loop.

After acceptance, stop. The next roadmap phase remains provider activation/parity and canonical cross-tab data finalization. Do not begin provider activation, strategy research, `FNO_PAPER_V2` or `SWING_PAPER_V2` in this task.

---

## 13. Required final response format

Return only:

1. Verdict
2. Full route matrix summary
3. Route changes and state/provenance coverage
4. Six-viewport and screenshot results
5. Accessibility and console results
6. Performance/bundle results
7. Tests, typechecks and builds
8. Git/integrity record
9. Evidence path, SHA-256 and terminator proof
10. Remaining roadmap status

Do not return an execution diary.
