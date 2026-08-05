# MARKET SCANNER PROMPT 25C — AUTHENTICATED VISUAL PROOF ONLY

## Objective

Prompt 25B is functionally complete: 104 new tests passed, scanner reached 1,210/1,210, API server reached 5,673/5,673, four typechecks were clean, and both production builds passed.

Do not reopen or re-audit those gates. Close only the missing authenticated visual-evidence requirement, then proceed directly to Pack 7.

Work only on Stock Scanner Pro. `artifacts/global/**` remains frozen and excluded.

## Restrictions

- No provider activation or live-provider probing.
- No operational DB query or write is required.
- No strategy, signalling, trading, ledger, history, or API-contract changes.
- No refactor or design-system expansion.
- No commit, push, pull, fetch, publish, or deployment.
- Use the existing development fixture/auth-bypass harness. It must remain gated by `import.meta.env.DEV && VITE_PREVIEW_BYPASS === "true"` and absent from production behavior.

## Gate 1 — Preflight

Record HEAD, branch, working tree, and the Prompt 25B evidence terminator. Confirm the accepted Prompt 25B files and tests are present.

If HEAD moved only through platform documentation/attachment auto-commits, record and continue. Stop only if production/test/config files changed unexpectedly.

## Gate 2 — Production-shaped authenticated states

Extend existing deterministic fixtures only where necessary to reproduce the actual corrected states. Do not fabricate live-provider proof.

Render and visually verify:

1. F&O paper-trading/account summary:
   - reconciled strategy/trade-attributed P&L is visually primary;
   - `Net vs. seed — balance only, not strategy P&L` is secondary;
   - the ₹8 lakh-scale balance delta cannot be mistaken for strategy profit.
2. Intraday report:
   - zero decided trades renders win rate `—`;
   - expired/open outcomes are separately labelled.
3. P&L Overview:
   - absent Largest Win/Loss and setup extremes render `—`, not ₹0.
4. Institutional Flows:
   - net-only historical gross Buy/Sell fields render `—`/net-only, not ₹0.00;
   - date, unit, and daily/monthly scope are visible.
5. OI Lab:
   - `Market Sentiment (based on OI)` scope is visible;
   - zero snapshots shows `No snapshots buffered`;
   - one snapshot shows `Buffer warming up`;
   - loading is visually distinct from no-data;
   - a rendered-data state displays the chart.
6. Relevant market-cue/count surface:
   - `US VIX` is explicit;
   - universe/available/unavailable/breadth counts have visible scope and reconcile.
7. Swing staged-order state:
   - if the expired HDFCBANK row no longer exists, show the safe empty/expired state from production-shaped fixture evidence;
   - do not recreate or write the operational row.

## Gate 3 — Required viewports and inspection

Capture every surface above at:

- 390×844;
- 768×1024;
- 1440×900.

For each capture verify:

- no login wall;
- no blank white page;
- no horizontal overflow;
- no navigation/header overlap;
- no clipped headline, table, tooltip, badge, or chart;
- no false live state;
- source, `asOf`, unit, scope, and unavailable labels remain legible where applicable;
- positive/negative/neutral colours are semantically correct;
- browser console has no unhandled exception.

Screenshots must be named by route, state, and viewport under:

`artifacts/audit-evidence/screenshots/p25c/`

Clearly label them `DETERMINISTIC_PRODUCTION_SHAPED_FIXTURE_EVIDENCE`, not live-provider evidence.

## Gate 4 — Fix only reproduced visual regressions

If a screenshot reveals a real defect, make the smallest page-level CSS/component fix and add a rendered-component regression test. Do not change underlying calculations or data.

If no defect is found, make no production-code change merely to create activity.

## Gate 5 — Verification

Always run:

- the Prompt 25A/25B targeted scanner tests;
- scanner TypeScript check;
- scanner production build;
- `git diff --check`;
- production-bundle check proving the bypass cannot activate in production;
- confirmation that `artifacts/global/**` remains untouched.

If any production or test code changes, additionally run:

- full scanner suite with floor 1,210;
- full API-server suite with floor 5,673 if API code or contracts changed;
- api-server, api-zod, and api-client-react typechecks if their code/contracts changed;
- API-server production build if API code changed.

No live provider calls and no DB connections are permitted from new visual tests.

## Evidence and verdict

Append a Prompt 25C section to:

`artifacts/audit-evidence/PROMPT_25A_V2_PRODUCTION_TRUTH_AND_CROSS_TAB_RECONCILIATION.md`

Include:

- screenshot inventory with route/state/viewport;
- fixture-versus-live disclosure;
- visual findings and any minimal fixes;
- targeted/full verification results;
- confirmation that Global, strategy logic, DB history, providers, and broker execution were untouched.

Final nonblank line:

`END_PROMPT_25C_AUTHENTICATED_VISUAL_PROOF_ONLY`

Return exactly:

`ACCEPT_PROMPT_25C_AUTHENTICATED_VISUAL_PROOF_ONLY`

If the authenticated deterministic harness cannot render an affected surface, return:

`BLOCKED_PROMPT_25C — <exact route, missing fixture/contract, and error>`

After acceptance, Prompt 25A/25B/25C is fully closed and Pack 7 provider activation/shadow parity is the immediate next task.
