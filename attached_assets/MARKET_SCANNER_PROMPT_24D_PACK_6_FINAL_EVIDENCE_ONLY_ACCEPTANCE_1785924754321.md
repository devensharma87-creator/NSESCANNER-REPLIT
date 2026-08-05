# STOCK SCANNER PRO — PROMPT 24D

## Pack 6 Final Evidence-Only Acceptance

### Current verdict

`PACK_6_IMPLEMENTATION_COMPLETE — FINAL_ACCEPTANCE_EVIDENCE_INCOMPLETE`

Do not perform another broad code pass. Do not redesign any page. The reported implementation, route matrix, four-route fixtures, tests and builds are provisionally accepted.

This task exists only because the final response omitted Gate C and Gate D evidence and reported Charting at three viewports instead of the four explicitly required by Prompt 24C.

Global Multi Asset Scanner remains `SEPARATE_PROJECT — FROZEN` and must not be touched or counted.

---

## 1. Execution rule

First read the existing Pack 6 evidence and screenshot inventory.

- If the missing proof already exists, return it without editing production code.
- If one evidence item is absent, add only that evidence item.
- Production code may be changed only if the missing check discovers a real defect.
- Do not create another task, prompt, pack or audit cycle.
- Do not rerun completed suites unless a new code/test change is required.
- No commit, push, pull, fetch, deploy or publish.

---

## 2. Evidence A — Reconcile the route count

The earlier reports stated `37` registered routes; the latest report states `38` because `/legal/privacy` was added to the count.

Provide:

1. the exact number of `<Route>` registrations in `artifacts/scanner/src/App.tsx`;
2. the exact `38`-row route list, or corrected count;
3. confirmation that every path appears exactly once in the evidence matrix;
4. identification of aliases, redirects and parameterized routes;
5. navigation-link parity result.

Do not group routes into “remaining routes.”

---

## 3. Evidence B — Complete the Charting viewport

Prompt 24C required Charting at:

- `390×844`;
- `768×1024`;
- `1024×768`;
- `1440×900`.

The final response reported only three viewports for every missing route.

Provide the four exact Charting screenshot paths and dimensions. If `1024×768` is missing, capture only that one screenshot using the existing deterministic fixture environment.

For each Charting screenshot record:

- viewport;
- visible symbol/timeframe;
- candle count;
- provenance label;
- horizontal overflow result;
- clipped-control result;
- browser-console errors and warnings.

Correct the phrase “10 real candles.” These are deterministic contract-valid fixture candles, not live or historical market observations. The evidence and final response must call them `10 deterministic valid OHLC fixture candles`.

---

## 4. Evidence C — Complete state matrix

Return a table mapping every state to one actual Stock Scanner Pro route, one screenshot path and one executable test:

| State |
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

For every row include:

- route;
- fixture/source metadata;
- screenshot path;
- test file and test name;
- displayed label;
- proof that null/missing values are not shown as zero, bullish, live or successful.

Do not claim `READY_LIVE` using invented or internally contradictory metadata. Yahoo/display fallbacks may only be delayed/display-grade. Kite fixtures may be labelled live only when their contract-valid freshness metadata satisfies the canonical resolver.

If a screenshot for a state is genuinely unnecessary because the state is proved by a real rendered-component test, state that explicitly and provide the test name. Do not fabricate a screenshot path.

---

## 5. Evidence D — Accessibility and browser-console results

For each of the four newly covered routes—Stock Detail, Charting, Portfolio Analyser and Daily Analysis—return:

| Check | Result |
|---|---|
| One logical H1 | Pass/fail + evidence |
| Ordered headings | Pass/fail |
| Labelled controls | Pass/fail |
| Keyboard-operable controls/tabs | Pass/fail |
| Visible focus | Pass/fail |
| Table/scroll containment | Pass/fail/N/A |
| No document-level overflow | Pass/fail |
| No clipped controls | Pass/fail |
| Reduced-motion compatibility | Pass/fail |

Return exact browser-console counts for each route:

- unhandled exceptions;
- React errors;
- failed fixture requests;
- accessibility warnings;
- other warnings.

“Zero unhandled exceptions” alone is insufficient. If known benign warnings remain, list their exact source and why they are safe.

---

## 6. Evidence E — Bundle and production-fixture proof

Return:

1. Scanner JS total;
2. Scanner CSS total;
3. largest entry chunk;
4. largest lazy chunk;
5. comparison with the recorded `2,854 KB JS / 256 KB CSS` Pack 6B result;
6. production build scan for `VITE_PREVIEW_BYPASS` and fixture-only sentinel values;
7. client bundle scan for provider keys, session secrets, owner credentials and server-only imports;
8. confirmation that deterministic fixtures make no live provider, DB, Telegram or broker call.

If the fixture module remains physically bundled but unreachable, do not call it “tree-shaken out.” Report the exact bundle result honestly. Acceptance requires it to be absent or provably inert and inaccessible in production.

---

## 7. Existing verification record

Reconcile and restate the already completed results:

- Scanner: `1,112 / 1,112`;
- API server: `5,603 / 5,603`;
- Scanner, API server, API Zod and API client React typechecks: clean;
- Scanner and API-server production builds: pass;
- `git diff --check`: clean;
- secret/fixture sentinels: pass;
- `DB_TEST_RUNTIME_AUTHORIZED`: unchanged;
- Global Multi Asset Scanner: frozen and excluded.

If no file changed in this evidence-only task, do not rerun the full suites. Record that the results remain tied to the same unchanged HEAD. If HEAD changed, stop and report the movement before relying on prior results.

---

## 8. Evidence integrity

Update only if required:

`artifacts/audit-evidence/FAST_TRACK_PACK_6_PROFESSIONAL_UI_UX_REFINEMENT.md`

The final nonblank line must be exactly:

`END_FAST_TRACK_PACK_6_FINAL_EVIDENCE_ONLY_ACCEPTANCE`

It must occur exactly once.

Return:

- evidence path;
- SHA-256;
- terminator count;
- final nonblank line;
- HEAD and working-tree state;
- confirmation that `artifacts/global` was untouched.

---

## 9. Final verdict rule

Return:

`ACCEPT_FAST_TRACK_PACK_6_PROFESSIONAL_UI_UX_REFINEMENT`

only if Evidence A through E is complete and internally consistent.

Otherwise return one exact evidence blocker. Do not create another development task.

After acceptance, stop. The next roadmap phase is provider activation/parity for Stock Scanner Pro.

---

## 10. Required final response format

Return only:

1. Verdict
2. Route-count reconciliation
3. Four Charting viewport records
4. Complete state matrix
5. Accessibility and console table
6. Bundle and production-fixture proof
7. Existing tests/typechecks/builds reconciliation
8. Git, Global-freeze and evidence-integrity record
9. Remaining roadmap status

Do not return an execution diary.
